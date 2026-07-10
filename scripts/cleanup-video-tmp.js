import fs from 'node:fs';
import path from 'node:path';

const VIDEO_ANALYSIS_ROOT = path.join(
  process.cwd(),
  "apps",
  "worker",
  "tmp",
  "video-analysis"
);

async function getDirStats(dirPath) {
  let size = 0;
  try {
    const files = await fs.promises.readdir(dirPath, { recursive: true });
    for (const file of files) {
      const stats = await fs.promises.stat(path.join(dirPath, file)).catch(() => null);
      if (stats && stats.isFile()) {
        size += stats.size;
      }
    }
  } catch {
    // Ignore error
  }
  return { size };
}

async function main() {
  console.log(`Checking temporary video-analysis directory at: ${VIDEO_ANALYSIS_ROOT}`);
  if (!fs.existsSync(VIDEO_ANALYSIS_ROOT)) {
    console.log("Directory does not exist. Nothing to clean up.");
    return;
  }

  const entries = await fs.promises.readdir(VIDEO_ANALYSIS_ROOT, { withFileTypes: true });
  let cleanedJobs = 0;
  let totalSavedBytes = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const jobDir = path.join(VIDEO_ANALYSIS_ROOT, entry.name);
    const timelinePath = path.join(jobDir, "timeline.json");

    // If there is no timeline.json, the job is incomplete/failed/aborted.
    // We can delete the entire directory.
    if (!fs.existsSync(timelinePath)) {
      console.log(`Job folder ${entry.name} is incomplete (no timeline.json). Deleting entire folder...`);
      const stats = await getDirStats(jobDir);
      totalSavedBytes += stats.size;
      await fs.promises.rm(jobDir, { recursive: true, force: true });
      cleanedJobs++;
      continue;
    }

    // If the job is complete (has timeline.json), we clean up:
    // - Any source.* file (like source.mp4)
    // - manifest.json
    // - frames/ directory
    // - frame-artifacts/ directory
    console.log(`Cleaning up temporary files for completed job ${entry.name}...`);
    const jobFiles = await fs.promises.readdir(jobDir, { withFileTypes: true });
    for (const jobFile of jobFiles) {
      const filePath = path.join(jobDir, jobFile.name);
      
      if (jobFile.isFile()) {
        if (jobFile.name.startsWith("source.") || jobFile.name === "manifest.json") {
          const stats = await fs.promises.stat(filePath).catch(() => null);
          if (stats) {
            totalSavedBytes += stats.size;
          }
          await fs.promises.rm(filePath, { force: true });
        }
      } else if (jobFile.isDirectory()) {
        if (jobFile.name === "frames" || jobFile.name === "frame-artifacts") {
          const stats = await getDirStats(filePath);
          totalSavedBytes += stats.size;
          await fs.promises.rm(filePath, { recursive: true, force: true });
        }
      }
    }
    cleanedJobs++;
  }

  console.log(`\n✓ Cleanup complete! Processed ${cleanedJobs} job directories.`);
  console.log(`Saved roughly ${(totalSavedBytes / (1024 * 1024)).toFixed(2)} MB of disk space.`);
}

main().catch(err => {
  console.error("Error during cleanup:", err);
  process.exit(1);
});
