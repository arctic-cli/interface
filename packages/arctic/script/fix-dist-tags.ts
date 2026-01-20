#!/usr/bin/env bun

/**
 * Fix dist-tags for published Arctic packages
 *
 * This script adds the "main" dist-tag to all platform-specific packages
 * that were published without it, ensuring npm can resolve optionalDependencies.
 *
 * Usage:
 *   bun ./script/fix-dist-tags.ts [version]
 *
 * Examples:
 *   bun ./script/fix-dist-tags.ts 0.0.0-main-202601081714
 *   bun ./script/fix-dist-tags.ts  # Uses latest from npm
 */

import { $ } from "bun"

const platformTargets = [
  "arctic-linux-x64",
  "arctic-linux-arm64",
  "arctic-linux-x64-baseline",
  "arctic-linux-x64-musl",
  "arctic-linux-arm64-musl",
  "arctic-linux-x64-musl-baseline",
  "arctic-darwin-x64",
  "arctic-darwin-arm64",
  "arctic-darwin-x64-baseline",
  "arctic-windows-x64",
  "arctic-windows-x64-baseline",
]

async function getVersionToFix(): Promise<string> {
  const versionArg = process.argv[2]

  if (versionArg) {
    console.log(`Using version from argument: ${versionArg}`)
    return versionArg
  }

  console.log("No version specified, fetching latest from npm...")
  const result = await $`npm view @arctic-cli/arctic dist-tags --json`.json()

  if (result.main) {
    console.log(`Found main dist-tag version: ${result.main}`)
    return result.main
  }

  if (result.beta) {
    console.log(`Found beta dist-tag version: ${result.beta}`)
    return result.beta
  }

  throw new Error("Could not determine version to fix. Please specify version as argument.")
}

async function checkPackageExists(packageName: string, version: string): Promise<boolean> {
  const result = await $`npm view ${packageName}@${version} version 2>/dev/null`.text().then(
    (text) => text.trim(),
    () => null,
  )
  return result === version
}

async function getCurrentDistTags(packageName: string): Promise<Record<string, string>> {
  const result = await $`npm view ${packageName} dist-tags --json 2>/dev/null`.json().catch(() => ({}))
  return result
}

async function addDistTag(packageName: string, version: string, tag: string): Promise<boolean> {
  const command = `npm dist-tag add ${packageName}@${version} ${tag}`
  console.log(`  Running: ${command}`)

  const result = await $`npm dist-tag add ${packageName}@${version} ${tag}`.text().catch((error) => {
    console.error(`  ❌ Failed: ${error.message}`)
    return null
  })

  if (result === null) return false

  console.log(`  ✅ Success`)
  return true
}

async function main() {
  console.log("🔧 Arctic dist-tag fix script\n")

  const version = await getVersionToFix()
  const tagsToAdd = ["main", "latest"]

  console.log(`\nTarget version: ${version}`)
  console.log(`Tags to add: ${tagsToAdd.join(", ")}`)
  console.log(`Platform packages: ${platformTargets.length}`)
  console.log("")

  let successCount = 0
  let skipCount = 0
  let failCount = 0
  let notFoundCount = 0

  for (const target of platformTargets) {
    const packageName = `@arctic-cli/${target}`
    console.log(`\n📦 Processing ${packageName}`)

    // Check if package version exists
    const exists = await checkPackageExists(packageName, version)
    if (!exists) {
      console.log(`  ⚠️  Package version ${version} not found on npm, skipping...`)
      notFoundCount++
      continue
    }

    // Get current dist-tags
    const currentTags = await getCurrentDistTags(packageName)
    console.log(`  Current tags: ${JSON.stringify(currentTags)}`)

    let packageSuccess = true
    for (const tag of tagsToAdd) {
      if (currentTags[tag] === version) {
        console.log(`  ⏭️  Tag "${tag}" already points to ${version}, skipping...`)
        skipCount++
        continue
      }

      const success = await addDistTag(packageName, version, tag)
      if (!success) {
        packageSuccess = false
        failCount++
      }
    }

    if (packageSuccess) {
      successCount++
    }
  }

  // Also fix the main package
  console.log(`\n📦 Processing main package @arctic-cli/arctic`)
  const mainPackageExists = await checkPackageExists("@arctic-cli/arctic", version)

  if (mainPackageExists) {
    const currentTags = await getCurrentDistTags("@arctic-cli/arctic")
    console.log(`  Current tags: ${JSON.stringify(currentTags)}`)

    for (const tag of tagsToAdd) {
      if (currentTags[tag] === version) {
        console.log(`  ⏭️  Tag "${tag}" already points to ${version}, skipping...`)
        continue
      }

      await addDistTag("@arctic-cli/arctic", version, tag)
    }
  } else {
    console.log(`  ⚠️  Package version ${version} not found on npm, skipping...`)
  }

  console.log("\n" + "=".repeat(60))
  console.log("Summary:")
  console.log(`  ✅ Packages updated: ${successCount}`)
  console.log(`  ⏭️  Tags already set: ${skipCount}`)
  console.log(`  ⚠️  Packages not found: ${notFoundCount}`)
  console.log(`  ❌ Failed operations: ${failCount}`)
  console.log("=".repeat(60))

  if (failCount > 0) {
    console.log("\n⚠️  Some operations failed. Check the output above for details.")
    process.exit(1)
  }

  console.log("\n✨ Done!")
}

main().catch((error) => {
  console.error("\n❌ Fatal error:", error.message)
  process.exit(1)
})
