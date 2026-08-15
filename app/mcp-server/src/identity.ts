/**
 * Replaces the people in a tool result with positional handles.
 *
 * An agent reading these lists is deciding things about participants — who was selected, who has
 * not answered, who is due a gift — and it settles all of that by id. The names and addresses
 * beside them are what the app needs in order to write a letter and send it, not what the agent
 * needs in order to think, so they stop at this boundary rather than travelling to whichever
 * assistant is holding the conversation.
 *
 * The handle is positional, following the order the list already arrives in, so a coordinator can
 * line up "참가자 3" against the same row in the app.
 */
export function withPersonHandles(payload: unknown, listKey: string, label: string): unknown {
  if (typeof payload !== 'object' || payload === null) return payload;
  const record = payload as Record<string, unknown>;
  const list = record[listKey];
  if (!Array.isArray(list)) return payload;

  return {
    ...record,
    [listKey]: list.map((row, index) => {
      if (typeof row !== 'object' || row === null) return row;
      const { name: _name, email: _email, ...rest } = row as Record<string, unknown>;
      return { ...rest, handle: `${label} ${index + 1}` };
    }),
  };
}
