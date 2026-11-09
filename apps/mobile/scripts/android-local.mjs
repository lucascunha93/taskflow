// Prepara o app Android para testes com a API local e abre o Android Studio.
// Uso: npm run android:local --workspace mobile [-- --no-open]
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

// Os argumentos são fixos (sem entrada do usuário), então montar a linha de comando é seguro.
const run = (command, args, env = {}) => {
  const result = spawnSync([command, ...args].join(' '), { stdio: 'inherit', shell: true, env: { ...process.env, ...env } });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

run('npx', ['ng', 'build', '--configuration', 'native-local']);
if (!existsSync('android')) run('npx', ['cap', 'add', 'android'], { TASKFLOW_CAP_LOCAL: '1' });
run('npx', ['cap', 'sync', 'android'], { TASKFLOW_CAP_LOCAL: '1' });
if (!process.argv.includes('--no-open')) run('npx', ['cap', 'open', 'android']);
