#!/usr/bin/env node
/* ============================================================
   博客发布密码 → 哈希（生成前端要硬编码的那串）
   ------------------------------------------------------------
   用法：
     node gateway/hashpass.js "你的密码"

   输出的 JSON 原样粘到 assets/js/blog.js 的 BLOG_AUTH 里。

   算法：H0 = SHA256(salt || password)，再迭代 iterations 次 SHA256(H)
   —— 加盐 + 多轮迭代，把离线爆破的成本抬高 orders 级别。
   前端用同一套算法验证（WebCrypto 优先，不在安全上下文时退回纯 JS 实现）。

   注意：这是「前端校验」，只能保证源码里看不到明文密码。
   真要拦住恶意的人，得把校验挪到服务端。
   ============================================================ */
"use strict";

const crypto = require("crypto");

const ITERATIONS = 10000;

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest();
}

function hashPassword(password, saltHex, iterations) {
  const salt = Buffer.from(saltHex, "hex");
  let h = sha256(Buffer.concat([salt, Buffer.from(String(password), "utf8")]));
  for (let i = 0; i < iterations; i++) h = sha256(h);
  return h.toString("hex");
}

function main() {
  const password = process.argv[2];
  if (!password) {
    console.error('用法: node gateway/hashpass.js "你的密码"');
    process.exit(1);
  }
  const salt = crypto.randomBytes(16).toString("hex");
  const iterations = ITERATIONS;
  const hash = hashPassword(password, salt, iterations);

  const out = {
    alg: "sha256-iter",
    iterations: iterations,
    salt: salt,
    hash: hash
  };
  console.log(JSON.stringify(out, null, 2));
  console.error("\n--- 自检 ---");
  console.error("正确密码 ->", hash === out.hash ? "匹配" : "不匹配");
  console.error("错误密码 ->", hashPassword(password + "x", salt, iterations) === hash ? "不匹配（异常！）" : "不匹配（正常）");
}

main();
