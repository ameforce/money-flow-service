from __future__ import annotations

import asyncio
from collections import defaultdict

from fastapi import WebSocket

_SEND_TIMEOUT_SECONDS = 2.0


class HouseholdHub:
    def __init__(self) -> None:
        self._clients: dict[str, set[WebSocket]] = defaultdict(set)
        self._member_clients: dict[tuple[str, str], set[WebSocket]] = defaultdict(set)
        self._socket_member: dict[WebSocket, tuple[str, str]] = {}
        self._lock = asyncio.Lock()

    async def connect(self, household_id: str, user_id: str, websocket: WebSocket) -> None:
        async with self._lock:
            self._clients[household_id].add(websocket)
            member_key = (household_id, user_id)
            self._member_clients[member_key].add(websocket)
            self._socket_member[websocket] = member_key

    async def disconnect(self, household_id: str, websocket: WebSocket) -> None:
        async with self._lock:
            sockets = self._clients.get(household_id)
            if not sockets:
                member_key = self._socket_member.pop(websocket, None)
                if member_key is not None:
                    member_sockets = self._member_clients.get(member_key)
                    if member_sockets:
                        member_sockets.discard(websocket)
                        if not member_sockets:
                            self._member_clients.pop(member_key, None)
                return
            sockets.discard(websocket)
            member_key = self._socket_member.pop(websocket, None)
            if member_key is not None:
                member_sockets = self._member_clients.get(member_key)
                if member_sockets:
                    member_sockets.discard(websocket)
                    if not member_sockets:
                        self._member_clients.pop(member_key, None)
            if not sockets:
                self._clients.pop(household_id, None)

    async def disconnect_member(self, household_id: str, user_id: str) -> None:
        async with self._lock:
            sockets = list(self._member_clients.get((household_id, user_id), set()))
        for socket in sockets:
            try:
                await socket.close(code=1008)
            except Exception:  # noqa: BLE001
                pass
            await self.disconnect(household_id, socket)

    async def broadcast(self, household_id: str, payload: dict) -> None:
        async with self._lock:
            sockets = list(self._clients.get(household_id, set()))

        async def _send_once(socket: WebSocket) -> WebSocket | None:
            try:
                await asyncio.wait_for(socket.send_json(payload), timeout=_SEND_TIMEOUT_SECONDS)
                return None
            except Exception:  # noqa: BLE001
                return socket

        stale_results = await asyncio.gather(*[_send_once(socket) for socket in sockets], return_exceptions=False)
        stale = [socket for socket in stale_results if socket is not None]
        for socket in stale:
            await self.disconnect(household_id, socket)

