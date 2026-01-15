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
- Audio retention is 30 days, aligned with transcript retention.
- R2 lifecycle rules should delete audio objects after 30 days.

## User Controls
- Opt-in is a per-user setting.
- Users can disable opt-in at any time; subsequent turns will not upload audio.
