# Security Policy

## Supported Versions

Only the latest published version on npm (`@vit129/agy-plugin-cc`) receives
security fixes. There is no long-term support branch.

| Version | Supported |
| ------- | --------- |
| Latest  | ✅ |
| Older   | ❌ |

## Reporting a Vulnerability

If you find a security issue in this plugin (for example: unsafe handling
of the `agy` CLI output, command injection through job arguments, or
insecure storage of job state under `plugins/agy/scripts/lib/state.mjs`),
please report it privately rather than opening a public issue.

- Open a [GitHub Security Advisory](https://github.com/Vit129/agy-plugin-cc/security/advisories/new)
  for this repository, or
- Contact the maintainer directly via the GitHub profile [@Vit129](https://github.com/Vit129).

Please include:

1. A description of the issue and its potential impact.
2. Steps to reproduce (a minimal repro is ideal).
3. The plugin version and platform (Claude Code version, OS) you tested on.

## Response Expectations

This is an independently maintained personal project, not a commercial
product with an SLA. There is no guaranteed response time, but reports are
reviewed and, where valid, fixed and released as soon as reasonably
possible. Credit will be given in the changelog unless you request
otherwise.

## Scope Notes

This plugin is a companion/installer around the third-party `agy` CLI
(Google's Antigravity). Vulnerabilities in the `agy` CLI itself, or in
Google's Antigravity service, are out of scope here — please report those
to Google directly.
