# Audio Upload Opt-In

Audio upload is optional. By default, the client submits transcripts and timing stats only.

## Purpose
- Allow higher-quality scoring when the user explicitly enables audio upload.
- Support future pronunciation features that require audio.

## Default Behavior
- No audio is uploaded without explicit user consent.
- The client sends transcript, timing stats, and ASR metadata only.

## Retention (MVP)
- Audio is stored only when opt-in is enabled.
- Retention duration is not yet finalized and will be defined before production use.

## User Controls
- Opt-in is a per-user setting.
- Users can disable opt-in at any time; subsequent turns will not upload audio.
