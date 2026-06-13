# Protocol

Shared cross-package types and constants for the project.

This package owns stable values that both frontend and backend need, including the v1 BSC chain config and token addresses:

- BOX-BSC: `0x6386adc4bc9c21984e34fd916bb349dd861742af`

It should not contain secrets, RPC keys, DeBox app secrets, or relayer credentials.

It also owns shared public payload shapes such as `RoomInviteSummary`, so room share cards can be generated consistently by frontend previews and backend DeBox group messages.
