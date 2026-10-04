// pokebuddy 명령 가르기 — bin/pokebuddy 가 Node 판 검사·EPIPE·help·version·dist 확인을 마친 뒤 부른다 (설계 50번 3.8절)
// (예전 bin/pokebuddy 의 switch. 도움말 글자(USAGE)와 판 번호는 빌드 없이 답하려고 bin 에 두고 여기로 넘겨받는다)
import { parseArgs, type ParsedArgs } from "./args";
import { runGameCommand } from "./game";
import { startCompanion, stopCompanion } from "./run";
import { runSetup, runUninstall } from "./setup";
import { runStatus } from "./status";

export interface CliText {
  usage: string; // 도움말 — 잘못된 명령의 안내 아래에도 붙인다
  version: string; // package.json 의 판 번호
}

export async function runCli(argv: string[], text: CliText): Promise<void> {
  // game·trade 는 뒤의 인자를 그대로 넘긴다 — 인자 풀이(parseArgs)를 거치지 않는다
  const parsed: ParsedArgs = argv[0] === "game" ? { kind: "game" } : argv[0] === "trade" ? { kind: "trade" } : parseArgs(argv);
  switch (parsed.kind) {
    // 친구 교환 링크로 참가 — 떠 있는 동반자에 game trade.join 으로 보낸다
    case "trade":
      if (!argv[1]) {
        process.stderr.write("사용: pokebuddy trade <교환 링크>\n");
        process.exitCode = 2;
        return;
      }
      await runGameCommand(["trade.join", "-", `link=${argv[1]}`]);
      return;
    case "game":
      await runGameCommand(argv.slice(1));
      return;
    case "help":
      process.stdout.write(`${text.usage}\n`);
      return;
    case "version":
      process.stdout.write(`${text.version}\n`);
      return;
    case "setup":
      runSetup({ dryRun: parsed.flags!.has("--dry-run"), editor: !parsed.flags!.has("--no-editor") });
      return;
    case "uninstall":
      runUninstall({ dryRun: parsed.flags!.has("--dry-run"), purge: parsed.flags!.has("--purge"), editor: !parsed.flags!.has("--no-editor") });
      return;
    case "status":
      runStatus(parsed.rest![0]);
      return;
    case "companion":
      if (parsed.error) {
        process.stderr.write(`${parsed.error}\n\n${text.usage}\n`);
        process.exit(2);
      }
      // 예전처럼 기다리지 않는다 — 동반자 띄우기·내리기가 스스로 끝낼 때를 정한다
      if (parsed.stop) void stopCompanion();
      else void startCompanion(parsed.opts || {});
      return;
    default:
      process.stderr.write(`${parsed.error || "알 수 없는 명령"}\n\n${text.usage}\n`);
      process.exit(2);
  }
}
