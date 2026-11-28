"""Read Claude Code's interactive /usage panel without starting a model turn."""
import calendar
from datetime import datetime, timedelta, timezone
import errno
import fcntl
import json
import os
import pty
import re
import select
import signal
import struct
import sys
import termios
import time
from zoneinfo import ZoneInfo

ROWS, COLS = 48, 120
ESCAPE = re.compile(r'\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|\([A-Z0-9]|[@-_])|[\r\n\b\t]|[^\x00-\x1f\x7f]+')
RESET = re.compile(r'Resets\s*(?:(\w{3})\s*(\d{1,2})\s*at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*\(([^)]+)\)', re.I)
HEADINGS = {'5h': re.compile(r'^current\s+session\b|^5.hour\s+(?:limit|usage)\b', re.I),
            '7d': re.compile(r'^current\s+week(?:\s+\(all\s+models\))?$', re.I)}
PANEL_MARKER = re.compile(r'(?<![/\w])usage\b|\bResets\b|\b\d+\s*%\s*used\b', re.I)


def terminal_lines(raw):
    rows = [[' '] * COLS for _ in range(ROWS)]
    row = column = 0
    for token in ESCAPE.finditer(raw.decode('utf-8', 'replace')):
        value = token.group(0)
        if value.startswith('\x1b['):
            params = value[2:-1]
            action = value[-1]
            if any(char in params for char in '?>< '):
                continue
            amounts = [int(part or '0') for part in params.split(';') if part.isdigit() or not part]
            count = (amounts or [1])[0] or 1
            if action in 'Hf':
                row = count - 1
                column = ((amounts[1] if len(amounts) > 1 else 1) or 1) - 1
            elif action == 'A': row -= count
            elif action in 'BE': row += count
            elif action == 'F': row -= count
            elif action == 'C': column += count
            elif action == 'D': column -= count
            elif action == 'G': column = count - 1
            elif action == 'd': row = count - 1
            elif action == 'J':
                mode = (amounts or [0])[0]
                if mode == 2: rows = [[' '] * COLS for _ in range(ROWS)]
                elif mode == 0:
                    rows[row][column:] = [' '] * (COLS - column)
                    rows[row + 1:] = [[' '] * COLS for _ in range(ROWS - row - 1)]
            elif action == 'K':
                mode = (amounts or [0])[0]
                begin = 0 if mode in (1, 2) else column
                end = column + 1 if mode == 1 else COLS
                rows[row][begin:end] = [' '] * (end - begin)
            if action in 'EF': column = 0
        elif value.startswith('\x1b'):
            continue
        elif value == '\r': column = 0
        elif value == '\n':
            if row == ROWS - 1:
                rows.pop(0)
                rows.append([' '] * COLS)
            else: row += 1
        elif value == '\b': column -= 1
        elif value == '\t': column = (column // 8 + 1) * 8
        else:
            room = min(COLS - column, len(value))
            rows[row][column:column + room] = value[:room]
            column += room
        row = max(0, min(ROWS - 1, row))
        column = max(0, min(COLS, column))
    return [''.join(row).strip() for row in rows]


def reset_time(text):
    match = RESET.search(text)
    if not match:
        return None
    month, day, hour, minute, meridiem, zone = match.groups()
    try:
        now = datetime.now(ZoneInfo(zone))
        hour = int(hour)
        if meridiem:
            hour = hour % 12 + (12 if meridiem.lower() == 'pm' else 0)
        reset = now.replace(hour=hour, minute=int(minute or '0'), second=0, microsecond=0)
        if month:
            months = {name.lower(): index for index, name in enumerate(calendar.month_abbr) if name}
            reset = reset.replace(month=months[month.lower()], day=int(day))
            if reset < now - timedelta(days=180): reset = reset.replace(year=reset.year + 1)
        elif reset < now - timedelta(minutes=1):
            reset += timedelta(days=1)
        return reset.astimezone(timezone.utc).isoformat()
    except (KeyError, ValueError):
        return None


def parse_windows(lines):
    result = {}
    for index, line in enumerate(lines):
        for key, heading in HEADINGS.items():
            if not heading.match(line):
                continue
            nearby = []
            for candidate in lines[index:index + 5]:
                if nearby and re.match(r'current\s+(?:session|week)|^5.hour\s+(?:limit|usage)\b', candidate, re.I):
                    break
                nearby.append(candidate)
            text = ' '.join(nearby)
            percent = re.search(r'(\d{1,3})\s*%\s*used\b', text, re.I)
            if percent and int(percent[1]) <= 100:
                result[key] = {'remaining': 100 - int(percent[1]), 'reset': reset_time(text)}
    return result


def panel_result(lines):
    windows = parse_windows(lines)
    return windows if len(windows) == len(HEADINGS) else {'error': 'parse-failed'}


def read_panel(binary):
    pid, fd = pty.fork()
    if pid == 0:
        os.environ.update({'TERM': 'xterm-256color', 'NO_COLOR': '1', 'DISABLE_AUTOUPDATER': '1',
                           'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC': '1'})
        os.execvp(binary, [binary, '--setting-sources', '', '--settings', '{"disableAllHooks":true}'])
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', ROWS, COLS, 0, 0))
    data = b''
    deadline = time.monotonic() + 16
    sent = False
    submit = None
    try:
        while time.monotonic() < deadline and len(data) < 250_000:
            if select.select([fd], [], [], .15)[0]:
                try: chunk = os.read(fd, 8192)
                except OSError as error:
                    if error.errno == errno.EIO: break
                    raise
                if not chunk: break
                data += chunk
                if b'\x1b[6n' in chunk: os.write(fd, b'\x1b[1;1R')
            if not sent:
                if re.search(rb'trust this folder|quick safety check|trust the files', data, re.I):
                    return {'error': 'trust-required'}
                if '❯'.encode() in data:
                    os.write(fd, b'/usage')
                    sent = True
                    submit = time.monotonic() + .25
            if submit and time.monotonic() >= submit:
                os.write(fd, b'\r')
                submit = None
            if sent and b'Resets' in data:
                lines = terminal_lines(data)
                windows = panel_result(lines)
                if 'error' not in windows and not any('refreshing usage' in line.lower() for line in lines):
                    return windows
        lines = terminal_lines(data)
        if sent and any(PANEL_MARKER.search(line) or any(heading.match(line) for heading in HEADINGS.values()) for line in lines):
            if not any('refreshing usage' in line.lower() for line in lines):
                return panel_result(lines)
        return {'error': 'timeout'}
    finally:
        os.close(fd)
        try: os.kill(pid, signal.SIGTERM)
        except ProcessLookupError: pass
        for _ in range(10):
            reap, _ = os.waitpid(pid, os.WNOHANG)
            if reap: break
            time.sleep(.03)
        else:
            try: os.kill(pid, signal.SIGKILL)
            except ProcessLookupError: pass
            os.waitpid(pid, 0)


if __name__ == '__main__':
    try:
        argument = sys.argv[1]
        result = panel_result(sys.stdin.read().splitlines()) if argument == '--parse-panel' else read_panel(argument)
        print(json.dumps(result))
    except Exception as error:
        sys.exit(str(error))
