# Working Assumptions

These are current assumptions, not permanent truth. Agents may update them when
implementation reveals better constraints.

## Product assumptions

- It is acceptable to start narrow and learn by building.
- The first working demo is more important than a polished architecture.
- OpenCall should feel simple on the client side.
- OpenClaw compatibility matters, but not before the direct prototype works.

## Technical assumptions

- Expo is the mobile entry point.
- Gemini Live is the first voice backend to try.
- The bridge owns the Gemini Live connection.
- The phone should not talk to Gemini Live directly.
- The bridge should remain the integration point for future agent runtimes.

## Planning assumptions

- The repo is currently mostly empty.
- Agents should prefer small, incremental tasks over broad speculative design.
- Documentation in `.agents` should stay concise and actionable.
