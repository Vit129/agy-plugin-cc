# Changelog

All notable changes to agy-plugin-cc are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and agy-plugin-cc follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).
## [Unreleased]

### Documentation
- Add ARCHITECTURE.md per universal architecture rule ([`cd67fa7`](https://github.com/Vit129/agy-plugin-cc/commit/cd67fa73e3408fca6d48fba41893ea90bfddc6a2))
- Adopt AGENTS.md as canonical instruction file ([`191422c`](https://github.com/Vit129/agy-plugin-cc/commit/191422cd8b06164ddfc9b678620141b8d77c97d5))
- Update agent-memory location to central agent-memory-private ([`4a7c6a5`](https://github.com/Vit129/agy-plugin-cc/commit/4a7c6a5896406430f685cd9a479bd91b806cd1d7))
- Relicense to Apache-2.0 and credit codex-plugin-cc ([`15b9ce2`](https://github.com/Vit129/agy-plugin-cc/commit/15b9ce224e26d4a7929c202d726ae3f1839745e1))
- Credit Claude as co-developer and contributor ([`94b6566`](https://github.com/Vit129/agy-plugin-cc/commit/94b65665f4c570287ab8addf11d825b6d474af01))
- Install and update through the marketplace ([`c823e9d`](https://github.com/Vit129/agy-plugin-cc/commit/c823e9ddcfe03255637d10182d3dc38f75872cf2))

### Fixed
- Prefer Homebrew for the agy install hint and resolve agy off PATH ([`d2351d8`](https://github.com/Vit129/agy-plugin-cc/commit/d2351d81ad96babf0374e2f2031fc315c2e51b2b))
- Recommend the vendor installer, not the Homebrew cask ([`7c26a7b`](https://github.com/Vit129/agy-plugin-cc/commit/7c26a7bfd6d397774ff2b3fc2074ea6c6d6fa7cd))

## [1.5.1] - 2026-09-15

### Fixed
- Add research/audit exception to scope-narrowly rule ([`74cb615`](https://github.com/Vit129/agy-plugin-cc/commit/74cb6151030340d64e0accd33f959e7f4a00a0d7))

## [1.5.0] - 2026-08-23

### Added
- Add npm start as standard release entry point ([`3c3ddc4`](https://github.com/Vit129/agy-plugin-cc/commit/3c3ddc4548710b908b0ecdec58652c77ddf3a1e7))
- Add --model/--effort passthrough to agy rescue/task/review, fix model-id parsing ([`887ca5b`](https://github.com/Vit129/agy-plugin-cc/commit/887ca5b58018da932b0a5125a0adb8ee008d726e))

### Documentation
- Note agent-memory is gitignored + centrally backed up (claude-memory-private) ([`8679179`](https://github.com/Vit129/agy-plugin-cc/commit/8679179f727f8793b6b61cde7bf6fbe2850d33d7))
- Agent-memory-private rename (was claude-memory-private) ([`375a3d1`](https://github.com/Vit129/agy-plugin-cc/commit/375a3d1d8dee49cf67475f815060dc404e69447b))

## [1.4.0] - 2026-07-22

### Added
- Add Claude Code context layer (CLAUDE.md, .ai/, agent-memory/) ([`1fedaa8`](https://github.com/Vit129/agy-plugin-cc/commit/1fedaa885aeda9fb77ac3ac8ae40c54ff53ee0b2))
- Hands-off plugin auto-update via SessionStart hook ([`0db8e60`](https://github.com/Vit129/agy-plugin-cc/commit/0db8e605cfb79d4f83a2b1e64665b7d286f94bf3))
- Add agy doctor/models commands and extend task/review passthrough ([`a4bd31f`](https://github.com/Vit129/agy-plugin-cc/commit/a4bd31f462ffc233912024f13afd43e41d30d643))
- Add --project/--new-project/--dangerously-skip-permissions passthrough and changelog command ([`4efdb57`](https://github.com/Vit129/agy-plugin-cc/commit/4efdb57ecfe7fedddcfa3feea9c78db552aadbda))
- Check for newer git-clone version at session start, confirm before pull ([#3](https://github.com/Vit129/agy-plugin-cc/pull/3)) ([`4e9f59c`](https://github.com/Vit129/agy-plugin-cc/commit/4e9f59ce54ac058f957382cafcd7824617d83925))
- Add --model/--effort validation, --dry-run quota preview, agents/changelog commands to agy plugin ([`34cc2a5`](https://github.com/Vit129/agy-plugin-cc/commit/34cc2a5205c8100780e5a8ff7a94431432d45d1b))

### Documentation
- Add Antigravity keywords and variations for search ([`0b6b863`](https://github.com/Vit129/agy-plugin-cc/commit/0b6b8638c4ce3fff68acd77b61f2108588a14578))
- Add Antigravity search variations to README title and intro ([`60a627a`](https://github.com/Vit129/agy-plugin-cc/commit/60a627aa684bde817b8f0b9bb15354c34e98af6b))
- Add v1.2.0 changelog entry to README ([`e9108f6`](https://github.com/Vit129/agy-plugin-cc/commit/e9108f66bf6d2e8abbf1b5d5f3bdd2a5c5d46fdf))
- Remove Differences from codex-plugin-cc section ([`1db229f`](https://github.com/Vit129/agy-plugin-cc/commit/1db229fe77bc5bbea6d650953f81a0dca6e64cc2))
- Add MIT LICENSE, SECURITY.md, and license section in README ([`9c1c9dc`](https://github.com/Vit129/agy-plugin-cc/commit/9c1c9dcb3def5ff1f5a16230cfccef8948934500))
- Caveman-compress CLAUDE.md to cut input tokens ([`04a5ce7`](https://github.com/Vit129/agy-plugin-cc/commit/04a5ce786af053eed90925375eaa2c1a32e774c5))

## [1.1.0] - 2026-05-28

### Added
- Upgrade agy plugin to v2.0.0 — full feature parity with codex-plugin-cc ([`c9d9c3b`](https://github.com/Vit129/agy-plugin-cc/commit/c9d9c3b09413ddb6820ebf0031c4fa7e26a2147c))

### Documentation
- Update README for v1.1.0 — full command reference and architecture ([`72496f4`](https://github.com/Vit129/agy-plugin-cc/commit/72496f4e8f23a5ea2d66b854bd226e526e190905))
- Add v1.1.0 changelog and release notes to README ([`32bc5bc`](https://github.com/Vit129/agy-plugin-cc/commit/32bc5bc605ebe9114d4d249a86de128e4c031cd0))

## [1.0.0] - 2026-05-27

### Added
- Agy Claude Code plugin with rescue subagent, companion script, and skills ([`8569a2e`](https://github.com/Vit129/agy-plugin-cc/commit/8569a2ee5565b3469243c4cb516ca25e3adf2589))

### Documentation
- Rewrite README for public release — correct install command, all 3 commands documented ([`e48ea01`](https://github.com/Vit129/agy-plugin-cc/commit/e48ea01aed7e52b0cf8127fd5e569f2446ab7594))
- Fix agy CLI install commands — curl script, not npm package ([`da11d59`](https://github.com/Vit129/agy-plugin-cc/commit/da11d59bd5d6468477a455548a8ed07b01153343))
- Improve /agy:agy example to reflect general code use case ([`e851d3d`](https://github.com/Vit129/agy-plugin-cc/commit/e851d3d572187e4c6a633f63a7d9c4003f8427c5))

### Fixed
- Use agy:agy-rescue subagent type (not cc-agy-plugin:agy-rescue) ([`986d9ed`](https://github.com/Vit129/agy-plugin-cc/commit/986d9ed423595ebccf22671e00d96f75eb1dfd16))

