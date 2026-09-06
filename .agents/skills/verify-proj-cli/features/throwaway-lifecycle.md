# Throwaway Scratchpad Lifecycle

Throwaway Scratchpad Lifecycle lets a user generate time-boxed experimental scratchpads with Time-to-Live (TTL) expiration tracking, extend expiration dates, graduate valuable experiments into permanent Git-tracked projects, and identify or prune expired scratchpads.

## Sub-features

- `scratch-create` generates an isolated scratchpad folder under `throwawaysRoot` with TTL metadata recorded in `config.json`.
- `scratch-extend` increases the remaining lifespan of an active scratchpad by a specified number of days.
- `scratch-graduate` promotes a scratchpad to a permanent Git project in `projectsRoot` and cleans up throwaway metadata.
- `scratch-expired` lists or batch-deletes scratchpads whose TTL has elapsed.
- `scratch-delete` removes a single scratchpad folder and its metadata entry.

## How to get to it (user POV)

- Run `proj scratch <name> [--ttl <days>]` to create a scratchpad.
- Run `proj extend <name> [days]` to add days to the expiration date.
- Run `proj graduate <name>` to move the scratchpad to permanent workspace.
- Run `proj expired` or `proj expired -d` to inspect or prune expired scratchpads.
- Run `proj delete-throwaway <name>` to remove a scratchpad.

## Driving it with harness

Preconditions:

- `dist/index.js` is built and doctor passes.
- An isolated sandbox exists with empty `projects/` and `projects/throwaways/`.

- **Create scratchpad.** Create a scratchpad named `spike-test` with 2 days TTL. Run `node .agents/skills/verify-proj-cli/scripts/harness.mjs exec -- scratch spike-test --ttl 2`. Exit code `0` and stdout reports `Successfully created throwaway scratchpad "spike-test" ... (expires: ...)`. Directory `projects/throwaways/spike-test` is created.
- **Extend expiration.** Add 5 days to `spike-test`. Run `node .agents/skills/verify-proj-cli/scripts/harness.mjs exec -- extend spike-test 5`. Exit code `0` and stdout reports `Successfully extended throwaway "spike-test" by 5 days`.
- **Graduate to permanent project.** Promote `spike-test` to the permanent workspace. Run `node .agents/skills/verify-proj-cli/scripts/harness.mjs exec -- graduate spike-test`. Exit code `0` and stdout reports `Successfully graduated throwaway "spike-test" to <path>/projects/spike-test`. The directory `projects/spike-test` exists with `.git` initialized and `projects/throwaways/spike-test` is removed.
- **Check expired listing.** Run `node .agents/skills/verify-proj-cli/scripts/harness.mjs exec -- expired --json`. Exit code `0` and returns valid JSON array of expired scratchpads.
- **Capture proof.** Save CLI transcripts to `artifacts/verify-proj-cli/throwaway-lifecycle/transcript.txt`.

## Gotchas

- Throwaway metadata is stored in `.proj/config.json` under the `throwaways` key.
- Graduation initializes a Git repository with an initial commit if the scratchpad did not already have one.
- Deleting an expired scratchpad deletes both the directory on disk and the entry in `config.json`.
