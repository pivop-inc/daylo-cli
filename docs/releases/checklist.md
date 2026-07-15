# Daylo Release Checklist

Use this checklist before publishing a public release. Keep release creation and npm publishing explicit; do not treat this document as permission to do either.

## Metadata

- [ ] GitHub repository description is current.
- [ ] GitHub repository homepage points to `https://daylo.cc`.
- [ ] GitHub repository topics are current.
- [ ] Issue templates render correctly on GitHub.

## Local Verification

- [ ] `bun install --frozen-lockfile`
- [ ] `bun run check`
- [ ] `bun test`
- [ ] `bunx tsc --noEmit`
- [ ] `bunx oxlint`
- [ ] CLI smoke against a mock API.
- [ ] CLI smoke against the hosted API, using a redacted test account.

## Release Notes

- [ ] Draft notes exist under `docs/releases/`.
- [ ] Install instructions say `bunx daylo-cli`.
- [ ] Notes do not claim npm is published until the npm publish gate is complete.
- [ ] Provider status distinguishes implemented support from production-verified support.

## Publishing Gates

- [ ] Confirm the version and tag name.
- [ ] Confirm no secrets or private health data are present in examples, logs, or screenshots.
- [ ] Create the GitHub release only after final approval.
- [ ] Publish `daylo-cli` to npm only after final approval.
