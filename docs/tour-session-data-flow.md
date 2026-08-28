# Tour Session Data Flow

`tourTypes/{tourTypeId}` owns the ordered destination IDs for a tour type. A
guide availability slot identifies the guide, date, time range, capacity, and
joined user IDs. `sessions/{sessionId}` is the shared source of truth for the
created tour instance and its live roster.

## Lifecycle

1. Admin assigns a qualified guide and slot; the session starts as `pending`.
2. A verified tourist joins through the slot transaction. The same operation
   checks conflicts and atomically increments the booked count.
3. The join is mirrored to the session roster as `Joined`.
4. A valid session QR checks the registration and changes it to `Checked-In`.
5. The guide changes the session to `active`, marks ordered stops visited, and
   changes it to `ended`. Each stop visit is keyed by session, stop, and
   tourist so analytics writes are idempotent.
6. The feedback flow closes the session after feedback is collected.

Cancellation is allowed only while the session is pending. The roster entry is
retained as `Cancelled`, the slot count is decremented transactionally, and a
new registration is required to join again.

All role surfaces should read `sessions/{sessionId}.status` and the roster
entry status rather than maintaining local status flags. Notifications carry a
typed event and entity reference; `getNotificationTarget` is the shared route
map for deep links and parent fallbacks.