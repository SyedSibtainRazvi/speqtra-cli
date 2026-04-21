## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
- Save progress, checkpoint, resume → invoke checkpoint
- Code quality, health check → invoke health

## Versioning

Two independent versions:

- **CLI version** — `package.json:version`. Source of truth. `src/index.ts` reads
  it at runtime via `createRequire`, so `speqtra --version` always matches.
  Bump on every npm publish.
- **Skill version** — `skill/speqtra-index/SKILL.md` frontmatter `version:`.
  Independent from CLI. Bump **only when skill content changes** —
  `skill-installer.ts` compares bundled vs installed skill version to decide
  if a reinstall is needed. Bumping on unchanged content spams users with
  unnecessary updates.

Health stack: `tsc --noEmit`, `biome check src/`, `vitest run`, `knip`.
