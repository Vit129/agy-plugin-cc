# Changelog

All notable changes to agy-plugin-cc are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and agy-plugin-cc follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).
## [1.6.2] - 2026-11-24

### Removed
- Delete unused stop-gate helpers ([#34](https://github.com/Vit129/agy-plugin-cc/pull/34)) ([`1d96e74`](https://github.com/Vit129/agy-plugin-cc/commit/1d96e740c9c9c1db81be46dfe8617c623727dfc9))

## [1.6.1] - 2026-11-24

### Changed
- Split agy-companion.mjs into feature modules ([`98d0797`](https://github.com/Vit129/agy-plugin-cc/commit/98d0797f4afa115c04e74f13a72d37db3a086b5c))

## [1.6.0] - 2026-11-24

### Added
- Cheaper agy runs and leaner replies (--tier, output digest, --deep review, doc-to-md, media) ([`a5634dc`](https://github.com/Vit129/agy-plugin-cc/commit/a5634dcb0ac25a08f256a99ef11086b9b2a61216))
- Hand whole test-gated tasks to agy and transfer a session to agy ([`ff720c0`](https://github.com/Vit129/agy-plugin-cc/commit/ff720c0bf4a52e63530802a569b9b7375e12f56f))
- Record agy token usage per job so delegation cost can be measured ([`1bf0568`](https://github.com/Vit129/agy-plugin-cc/commit/1bf0568d3e476716f61c2dc60a6f1cefc178eec1))
- Add /agy:image, /agy:research, /agy:scrape and /agy:design-review ([`c86df2b`](https://github.com/Vit129/agy-plugin-cc/commit/c86df2b0eac568a9ab5146791675be0d323b8380))

### Changed
- Drop /agy:media, the watch plugin already covers audio and video ([`c97a1a9`](https://github.com/Vit129/agy-plugin-cc/commit/c97a1a945296678fe94532fefae4b5f55bf0953a))

### Documentation
- Restore section separator ([`44c6922`](https://github.com/Vit129/agy-plugin-cc/commit/44c692264142203b18fb88b74de3262d5bb2ab44))

### Fixed
- Add the missing 1.5.3 changelog section so release:check passes ([`aaada60`](https://github.com/Vit129/agy-plugin-cc/commit/aaada60c4eca627c50ef8558bc8b79a70bc947ba))

## [1.5.3] - 2026-11-22

### Fixed
- Report signal-killed commands as failures ([`298b2f9`](https://github.com/Vit129/agy-plugin-cc/commit/298b2f9332f2d52e1cb806f96e06826863430329))
- Reconcile stale running jobs when listing ([`343687c`](https://github.com/Vit129/agy-plugin-cc/commit/343687caba6d782356bc932f51127514b4181967))
- Retain stderr from successful agy runs ([`43a2b93`](https://github.com/Vit129/agy-plugin-cc/commit/43a2b931359a0eae47f8809ea29e761a08d33968))
- Surface foreground failure diagnostics ([`105f74e`](https://github.com/Vit129/agy-plugin-cc/commit/105f74eea00907ff2c1caa8545de9926fbe36a65))

## [1.5.2] - 2026-11-22

### Documentation
- Add ARCHITECTURE.md per universal architecture rule ([`cd67fa7`](https://github.com/Vit129/agy-plugin-cc/commit/cd67fa73e3408fca6d48fba41893ea90bfddc6a2))
- Adopt AGENTS.md as canonical instruction file ([`191422c`](https://github.com/Vit129/agy-plugin-cc/commit/191422cd8b06164ddfc9b678620141b8d77c97d5))
- Update agent-memory location to central agent-memory-private ([`4a7c6a5`](https://github.com/Vit129/agy-plugin-cc/commit/4a7c6a5896406430f685cd9a479bd91b806cd1d7))
- Relicense to Apache-2.0 and credit codex-plugin-cc ([`15b9ce2`](https://github.com/Vit129/agy-plugin-cc/commit/15b9ce224e26d4a7929c202d726ae3f1839745e1))
- Credit Claude as co-developer and contributor ([`94b6566`](https://github.com/Vit129/agy-plugin-cc/commit/94b65665f4c570287ab8addf11d825b6d474af01))
- Install and update through the marketplace ([`c823e9d`](https://github.com/Vit129/agy-plugin-cc/commit/c823e9ddcfe03255637d10182d3dc38f75872cf2))
- Unofficial notice, changelog in CHANGELOG.md only ([`f911023`](https://github.com/Vit129/agy-plugin-cc/commit/f911023886d6c4db347d70c68206de9d153a251e))
- Add cross-link to agy-plugin-codex ([`829fd9c`](https://github.com/Vit129/agy-plugin-cc/commit/829fd9cda7731897333944eba2af3a65a2ee1aa8))
- Update copyright notice with co-authors ([`45b6a9e`](https://github.com/Vit129/agy-plugin-cc/commit/45b6a9e1db672706dec101f728141e8216278dab))
- Add docs/ index per project structure standard ([#16](https://github.com/Vit129/agy-plugin-cc/pull/16)) ([`10a9897`](https://github.com/Vit129/agy-plugin-cc/commit/10a98972312ac60c576ab49f2532d8b5af21aa6e))
- Point agent memory path to unified-memory-vault ([#20](https://github.com/Vit129/agy-plugin-cc/pull/20)) ([`45ed22e`](https://github.com/Vit129/agy-plugin-cc/commit/45ed22e843f7d542f896cbdc6708852760616be8))

### Fixed
- Prefer Homebrew for the agy install hint and resolve agy off PATH ([`d2351d8`](https://github.com/Vit129/agy-plugin-cc/commit/d2351d81ad96babf0374e2f2031fc315c2e51b2b))
- Recommend the vendor installer, not the Homebrew cask ([`7c26a7b`](https://github.com/Vit129/agy-plugin-cc/commit/7c26a7bfd6d397774ff2b3fc2074ea6c6d6fa7cd))
- Run delegated agy outside sandbox ([#17](https://github.com/Vit129/agy-plugin-cc/pull/17)) ([`d77b861`](https://github.com/Vit129/agy-plugin-cc/commit/d77b861d9a6038eef1135797c45ef991db627778))
- Agy failures are reported, signal exits count as failures, background runs record their exit ([`740b3ea`](https://github.com/Vit129/agy-plugin-cc/commit/740b3ead51475019962e17fdae1dc80a070b3527))

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

