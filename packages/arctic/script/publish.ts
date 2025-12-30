#!/usr/bin/env bun
import { Script } from "@arctic-cli/script"
import { $ } from "bun"
import { fileURLToPath } from "url"
import pkg from "../package.json"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

const { binaries } = await import("./build.ts")
const baseName = pkg.name.includes("/") ? pkg.name.split("/")[1] : pkg.name
const shouldPublish = process.argv.includes("--publish")
const tagIndex = process.argv.findIndex((arg) => arg === "--tag")
const publishTag = tagIndex >= 0 ? process.argv[tagIndex + 1] : undefined
const otpIndex = process.argv.findIndex((arg) => arg === "--otp")
const otpValue =
  otpIndex >= 0
    ? process.argv[otpIndex + 1]
    : process.argv.find((arg) => arg.startsWith("--otp="))?.slice("--otp=".length)
{
  const name = `@arctic-cli/${baseName}-${process.platform}-${process.arch}`
  console.log(`smoke test: running dist/${name}/bin/arctic --version`)
  await $`./dist/${name}/bin/arctic --version`
}

await $`mkdir -p ./dist/${baseName}`
await $`cp -r ./bin ./dist/${baseName}/bin`
await $`cp ./script/postinstall.mjs ./dist/${baseName}/postinstall.mjs`

await Bun.file(`./dist/${baseName}/package.json`).write(
  JSON.stringify(
    {
      name: "@arctic-cli/arctic",
      bin: {
        [baseName]: `./bin/${baseName}`,
      },
      scripts: {
        postinstall: "bun ./postinstall.mjs || node ./postinstall.mjs",
      },
      version: Script.version,
      optionalDependencies: binaries,
    },
    null,
    2,
  ),
)

// npm publish temporarily disabled; keep binaries locally for manual distribution

if (!Script.preview) {
  for (const key of Object.keys(binaries)) {
    if (key.includes("linux")) {
      await $`cd dist/${key}/bin && tar -czf ../../${key}.tar.gz *`
    } else {
      await $`cd dist/${key}/bin && zip -r ../../${key}.zip *`
    }
  }
  console.log("Archives ready for GitHub release uploads")
}

if (shouldPublish) {
  const platformPackages = Object.keys(binaries)
  const defaultTag = publishTag || Script.channel
  const tagArgs = ["--tag", defaultTag]
  const otpArgs = otpValue ? ["--otp", otpValue] : []
  for (const name of platformPackages) {
    console.log(`publishing ${name}`)
    await $`cd dist/${name} && npm publish --access public ${tagArgs} ${otpArgs}`
  }
  console.log(`publishing @arctic-cli/${baseName}`)
  await $`cd dist/${baseName} && npm publish --access public ${tagArgs} ${otpArgs}`
}
