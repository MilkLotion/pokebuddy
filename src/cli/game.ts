// 게임 명령 진입 — 관리 창과 같은 명령을 명령 통로(mailbox)로 보낸다. 게임 저장은 writer 만 바꾼다 (docs/contributing/development.md "게임 명령")
import { PATHS } from "../platform/paths";
import { sendToWriter } from "../save/command-channel";
import { commandNamesWhere } from "../shared/names/commands";
import type { Command } from "../shared/command";
import type { CommandName } from "../shared/names/commands";

// CLI 가 받는 명령 — 목록은 src/shared/names/commands.ts 의 cli
const allowed: readonly string[] = commandNamesWhere("cli");

export async function game(argv: string[]): Promise<void> {
  const [name = "snapshot", target, ...fields] = argv;
  if (name === "--help") {
    process.stdout.write("pokebuddy game <command> [pet-id|product-id|-] [key=value ... | JSON]\nCommands: snapshot, shop.buy, evolve, pet.set, pet.form, feed, play, party.show, party.hide,\n  trade.create, trade.join, trade.offer, trade.ready, trade.unready, trade.leave, trade.status\nExamples: pokebuddy game shop.buy random · pokebuddy game evolve p1 to=umbreon · pokebuddy game pet.form p1 species=lunala\n  pokebuddy game trade.join - link=<trade link> · pokebuddy game trade.offer p1 · pokebuddy game trade.ready\n");
    return;
  }
  try {
    if (!allowed.includes(name as CommandName)) throw new Error("Unknown command. Use pokebuddy game --help.");
    const args: unknown = fields.length === 1 && fields[0]!.startsWith("{") ? JSON.parse(fields[0]!) : Object.fromEntries(fields.map((field) => {
      const at = field.indexOf("=");
      if (at <= 0) throw new Error("Use key=value for each argument.");
      const key = field.slice(0, at), value = field.slice(at + 1);
      // 참·거짓과 숫자는 그 값으로 넘긴다 — `size=3` 은 3 이다
      return [key, value === "true" ? true : value === "false" ? false : /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value];
    }));
    if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("Use a JSON object for arguments.");
    const command: Command = { cmd: name as CommandName, from: "cli", args: args as Record<string, unknown> };
    if (target && target !== "-") command.target = target;
    const result = await sendToWriter(PATHS.mailbox, command);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) process.exitCode = 1;
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 2;
  }
}
