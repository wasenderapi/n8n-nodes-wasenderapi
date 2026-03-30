# AGENTS.md

This file gives coding agents enough context to work safely in this repository without freezing implementation details that may evolve over time.

## Repo Overview

- Package: `n8n-nodes-wasenderapi-official`
- Type: n8n community node package
- Purpose: integrate WasenderAPI into n8n

Main areas of the codebase:

- `credentials/`: n8n credential definitions
- `nodes/WasenderApi/`: action node, resources, list-search helpers, and shared transport/descriptions
- `nodes/WasenderApiTrigger/`: webhook trigger lifecycle and output shaping
- `icons/`: light and dark SVG assets used in the package

## Working Style

- Read the current implementation before changing behavior.
- Keep changes small and consistent with existing patterns.
- Prefer extending the current transport, trigger, resource, and list-search layers instead of adding parallel paths.
- When a change affects both editor configuration and runtime execution, verify both.

## File Guide

### Root

- `package.json`: package metadata, n8n manifest, and scripts
- `README.md`: end-user documentation
- `AGENTS.md`: this guide
- `icons/`: package assets

### Credentials

- `credentials/`: credential definitions used by the nodes

### Action Node

- `nodes/WasenderApi/WasenderApi.node.ts`: main execute flow
- `nodes/WasenderApi/resources/`: resource and operation definitions
- `nodes/WasenderApi/listSearch/`: resource locator loaders
- `nodes/WasenderApi/shared/descriptions.ts`: shared node properties
- `nodes/WasenderApi/shared/transport.ts`: request helpers and transport logic

### Trigger Node

- `nodes/WasenderApiTrigger/WasenderApiTrigger.node.ts`: webhook registration, validation, teardown, and output shaping

## Commands

Normal development loop:

```bash
npm run build
npm run lint
```

Other useful commands:

```bash
npm run dev
npm run build:watch
npm run release
```

Notes:

- `npm run release` uses `n8n-node release`
- release/build assets require both `icons/wasenderapi.svg` and `icons/wasenderapi.dark.svg`
- there are no dedicated unit tests right now; `build` and `lint` are the main verification steps

## Areas That Need Extra Care

### Auth and transport

- Review credential definitions and shared transport together.
- Keep request flows consistent across the node surface.
- Avoid adding new auth surfaces unless there is a clear product need.

### Trigger behavior

- Treat webhook registration, deletion, validation, and emitted payload shape as one system.
- If trigger output changes, check downstream action-node expectations too.

### Resource selectors and list search

- Resource locator behavior affects both editor UX and runtime execution.
- Any selector change should be checked in list mode, manual ID mode, and execution from upstream input where relevant.
- List-search helpers should return stable stored values, not only readable labels.

### API response handling

- Wasender responses are not guaranteed to use identical field names across endpoints.
- Confirm the actual payload shape in the code path you are changing before normalizing or reusing mappers.

### Binary and media outputs

- Operations that fetch files should return useful JSON metadata and populate `binary.data`.
- Preserve filename and mime-type handling when adjusting download flows.

## Local Development Notes

- This package may be loaded locally as a community node under `~/.n8n/nodes`.
- After node code changes, run `npm run build`.
- If the n8n UI does not reflect the change, restart the running `n8n` process.

## Verification

For code changes, run:

```bash
npm run build
npm run lint
```

- For trigger or selector changes, verify the end-to-end flow, not only static checks.
- For docs-only changes, full build/lint is optional.

## Recommended Reading Before Large Changes

- `README.md`
- `package.json`
- `nodes/WasenderApi/WasenderApi.node.ts`
- `nodes/WasenderApi/shared/transport.ts`
- `nodes/WasenderApi/shared/descriptions.ts`
- `nodes/WasenderApiTrigger/WasenderApiTrigger.node.ts`
- `nodes/WasenderApi/listSearch/getSessions.ts`
- `nodes/WasenderApi/listSearch/getContacts.ts`
- `nodes/WasenderApi/listSearch/getGroups.ts`

## Short Summary For Future Agents

- read the existing implementation before changing architecture
- keep auth and transport changes consistent with shared helpers
- treat trigger lifecycle and payload shape as a single contract
- verify selector behavior in both editor and execution contexts
- confirm list-search values and binary outputs end-to-end
- run build and lint for code changes
