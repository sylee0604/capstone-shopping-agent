// 확장 프로그램 빌드: src/ui/sidepanel.js를 번들링하고 extension/ 파일을 dist/로 복사
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });
cpSync('extension', 'dist', { recursive: true });
await build({
  entryPoints: ['src/ui/sidepanel.js'],
  bundle: true, format: 'esm', platform: 'browser', target: 'chrome120',
  outfile: 'dist/sidepanel.js', sourcemap: true, logLevel: 'info',
});
console.log('dist/ 준비 완료 — chrome://extensions 에서 "압축해제된 확장 프로그램 로드"로 dist 폴더 선택');
