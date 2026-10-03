// 울음소리 — 기기 창(도감·파티 상세)의 울음소리 단추. 새로 틀면 앞 소리를 멈춘다. 음량은 메인이 준 값(설정의 소리 크기를 곱한 것)
// 무대는 쓰지 않는다 — 마리마다 겹쳐 울게 앞 소리를 멈추지 않는다 (stage/stage.ts onCry)

export interface CryPlayer {
  setVolume(volume: number): void;
  play(): Promise<void>;
}

export function createCryPlayer(fetchCry: () => Promise<string | null>): CryPlayer {
  let audio: HTMLAudioElement | null = null;
  let volume = 0;
  return {
    setVolume(next) {
      volume = next;
    },
    async play() {
      const uri = await fetchCry();
      if (!uri) return;
      audio?.pause();
      audio = new Audio(uri);
      audio.volume = volume;
      void audio.play().catch(() => undefined);
    },
  };
}
