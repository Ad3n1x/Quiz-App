import { io, type Socket } from 'socket.io-client';

const base = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
type ApiResponse<T = any> = { data: T };
async function request<T = any>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
  const response = await fetch(base + path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || data?.message || 'Request failed. Please try again.');
  return { data };
}
export const api = {
  get: <T = any>(path: string) => request<T>('GET', path),
  post: <T = any>(path: string, body?: unknown) => request<T>('POST', path, body),
};
type QZConnection = {
  ready: Promise<void>;
  connectionId: string;
  onMessage: (callback: (message: any) => void) => void;
  onError: (callback: (error: unknown) => void) => void;
  disconnect: () => void;
};
export const ws = {
  connect(): QZConnection {
    const socket: Socket = io(base || window.location.origin, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      reconnection: true,
    });
    let messageHandler: ((message: any) => void) | undefined;
    let errorHandler: ((error: unknown) => void) | undefined;
    socket.on('entity.update', message => messageHandler?.(message));
    socket.on('connect_error', error => errorHandler?.(error));
    socket.on('disconnect', reason => {
      if (reason !== 'io client disconnect') errorHandler?.(new Error('Live connection interrupted.'));
    });
    const connection = {
      get connectionId() { return socket.id || ''; },
      ready: new Promise<void>((resolve, reject) => {
        if (socket.connected) resolve();
        else {
          socket.once('connect', () => resolve());
          socket.once('connect_error', error => reject(error));
        }
      }),
      onMessage(callback: (message: any) => void) { messageHandler = callback; },
      onError(callback: (error: unknown) => void) { errorHandler = callback; },
      disconnect() { socket.disconnect(); },
    };
    return connection;
  },
};
