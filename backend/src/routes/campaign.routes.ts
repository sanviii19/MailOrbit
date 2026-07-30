import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import * as campaignController from '../controllers/campaign.controller';
import { authenticate } from '../middleware/authenticate';

const router = Router();

const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer: local disk storage for CSV and attachments (max 25 MB per file)
const storage = multer.diskStorage({
  destination: function (_req, _file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (_req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB max per file
});

// All campaign routes require authentication
router.use(authenticate);

// Create: accepts JSON body OR multipart/form-data with optional csv and attachments
router.post(
  '/', 
  upload.fields([{ name: 'csv', maxCount: 1 }, { name: 'attachments', maxCount: 10 }]), 
  campaignController.createCampaign
);
router.get('/', campaignController.listCampaigns);
router.get('/:id', campaignController.getCampaign);

export default router;
