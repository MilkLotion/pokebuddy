// [임시] 옛 자리 — src/main/commands.ts 와 src/tools 의 시험 셋(selftest-commands · legacy · stage)이 이 경로의 옛 이름을 읽는다. 원본은 ./command-channel.ts
// 읽는 쪽이 새 자리로 가면 이 파일을 지운다
export {
  CMD, REQUEST, RESULT, isCmdName, requestName, resultName,
  sendToWriter as send, serveCommands as serve,
  type ChannelLog as MailLog, type CommandHandler as MailHandler, type CommandServer as MailServer, type SendOptions, type ServeOptions,
} from "./command-channel.js";
