# Versioning

LocalSync Portal follows semantic versioning: **x.y.z**

| Segment | Meaning | Who decides | Example |
|---------|---------|-------------|---------|
| **z** (patch) | Minor tweaks, bug fixes, small issues | Any commit that fixes a bug or makes a small adjustment | 1.0.0 -> 1.0.1 |
| **y** (minor) | New features, significant enhancements | When a new capability is added | 1.0.1 -> 1.1.0 |
| **x** (major) | Major changes, breaking changes, architecture shifts | Dev team decision | 1.1.0 -> 2.0.0 |

## Rules

- Every version bump **must** have a corresponding release note in `docs/releases/`.
- Patch version resets to 0 on a minor bump (1.0.3 -> 1.1.0).
- Minor version resets to 0 on a major bump (1.5.2 -> 2.0.0).
- The current version is always in `/version.json` at the project root.
