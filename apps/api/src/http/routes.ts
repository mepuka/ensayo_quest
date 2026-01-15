import { handlers } from "./handlers";

export const routes = {
  "POST /api/rooms": handlers.createRoom,
  "POST /api/rooms/:id/turns": handlers.submitTurn,
  "GET /api/rooms/:id/stream": handlers.streamRoom
};
