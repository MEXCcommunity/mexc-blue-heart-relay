import { mkdir, readFile, writeFile } from "node:fs/promises";

const read = (name) => readFile(new URL(name, import.meta.url), "utf8");
const [template, client, geometry] = await Promise.all([
  read("./relay.html"), read("./relay.js"), read("./geometry.json"),
]);
const { land, mark } = JSON.parse(geometry);
const script = client.replace("__LAND__", JSON.stringify(land))
  .replace("__MARK__", JSON.stringify(mark))
  .replace("__LOCAL_ONLY__", "false");
const page = template.replace("__CAPACITY_RAW__", String(mark.length))
  .replace("__CAPACITY__", new Intl.NumberFormat("en-US").format(mark.length))
  .replace("__SCRIPT__", () => script);
const output = new URL("../dist/", import.meta.url);
await mkdir(output, { recursive: true });
await writeFile(new URL("index.html", output), page);
