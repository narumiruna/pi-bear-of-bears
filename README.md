# TypeScript Template

## Human workflow

Install dependencies, build, and run:

```sh
npm install
npm run build
npm start
```

## Automation

```sh
npm run ci
```

The CI command runs Biome, Vitest, and the TypeScript build. Husky runs it before each commit.
