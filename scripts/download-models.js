import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';

const MODELS = [
  {
    name: 'rf-detr-seg-nano.onnx',
    url: 'https://github.com/rajofearth/camx2/raw/v2/public/models/rf-detr-seg-nano.onnx'
  },
  {
    name: 'rfdetr-nano.onnx',
    url: 'https://github.com/rajofearth/camx2/raw/v2/public/models/rfdetr-nano.onnx'
  },
  {
    name: 'yolo11n.onnx',
    url: 'https://github.com/rajofearth/camx2/raw/v2/public/models/yolo11n.onnx'
  },
  {
    name: 'yolo11x.onnx',
    url: 'https://github.com/rajofearth/camx2/raw/v2/public/models/yolo11x.onnx'
  },
  {
    name: 'weapon-yolov8.onnx',
    url: 'https://huggingface.co/Hadi959/weapon-detection-yolov8/resolve/main/best.onnx'
  }
];

const targetDir = path.join(process.cwd(), 'public', 'models');

async function downloadFile(url, targetPath) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.statusText}`);
  }
  const fileStream = fs.createWriteStream(targetPath);
  await finished(Readable.fromWeb(response.body).pipe(fileStream));
}

async function main() {
  console.log('Checking model files...');
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  for (const model of MODELS) {
    const modelPath = path.join(targetDir, model.name);
    const tempPath = `${modelPath}.tmp`;

    if (fs.existsSync(modelPath)) {
      console.log(`✓ ${model.name} already exists.`);
      continue;
    }

    console.log(`Downloading ${model.name}...`);
    try {
      await downloadFile(model.url, tempPath);
      fs.renameSync(tempPath, modelPath);
      console.log(`✓ Successfully downloaded ${model.name}`);
    } catch (err) {
      console.error(`✗ Failed to download ${model.name}:`, err.message);
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
      process.exit(1);
    }
  }
}

main().catch(err => {
  console.error('Fatal error downloading models:', err);
  process.exit(1);
});
