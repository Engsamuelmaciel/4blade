// Gera o "senha_hash" de uma senha provisória, no mesmo formato da API.
// Uso (recuperação do Master pelo Console do D1):
//   node scripts/hash-senha.js
// Digite a senha provisória quando pedir. Nada é gravado em arquivo.
import { createInterface } from "node:readline";

const ITERACOES = 100000;
const hex = b => Buffer.from(b).toString("hex");

const rl = createInterface({ input: process.stdin, output: process.stderr });
rl.question("Senha provisória (mín. 8 caracteres): ", async senha => {
  rl.close();
  if (!senha || senha.length < 8) {
    console.error("Senha muito curta.");
    process.exit(1);
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(senha), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: ITERACOES, hash: "SHA-256" }, key, 256);
  console.log(`pbkdf2$${ITERACOES}$${hex(salt)}$${hex(bits)}`);
});
