#!/usr/bin/env node
/**
 * Writes a synthetic Nominet-style drop list (ROID, Domain Name, Drop Time)
 * for local development when the real list is unavailable.
 * Usage: node scripts/generate-sample-droplist.mjs [rows] [out.csv.gz]
 */
import { writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const rows = Number(process.argv[2] ?? 5000);
const out = process.argv[3] ?? "sample-droplist.csv.gz";
const words = ["shop", "cars", "home", "garden", "london", "tech", "hire", "best", "local", "pet", "cafe", "build", "design", "green", "smart", "travel", "north", "legal", "clean", "print"];
const tlds = ["co.uk", "co.uk", "co.uk", "org.uk", "uk", "me.uk"];

let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = (list) => list[Math.floor(rand() * list.length)];

const lines = ["ROID,Domain Name,Drop Time"];
const today = new Date();
for (let i = 0; i < rows; i += 1) {
  let label = pick(words) + (rand() < 0.6 ? pick(words) : "");
  if (rand() < 0.15) label += Math.floor(rand() * 100);
  if (rand() < 0.1) label = label.replace(/(.{3})/, "$1-");
  label += rand() < 0.5 ? i.toString(36) : "";
  const drop = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + Math.floor(rand() * 5), 13));
  lines.push(`${100000 + i}-UK,${label}.${pick(tlds)},${drop.toISOString().replace(".000", "")}`);
}
writeFileSync(out, gzipSync(lines.join("\n") + "\n"));
console.log(`Wrote ${rows} rows to ${out}`);
