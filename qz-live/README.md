# QZ Live

Source snapshot for the QZ Live multiplayer quiz arena.

## Live play

Open the active real-time app: https://qz-live-cu6x0l.v2.appdeploy.ai/

## Runtime note

The live multiplayer version uses AppDeploy's `@appdeploy/client`, `@appdeploy/sdk`, database, and WebSocket runtime. This folder preserves the frontend/backend source in GitHub; running the complete multiplayer experience on another host requires replacing those platform services with equivalent API, persistence, and realtime infrastructure.

## Features

- PIN-based host/player rooms
- Live room updates and standings
- Editable quiz questions
- Speed scoring and the final 2× Clutch Round
