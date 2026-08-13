import { Router, Request, Response } from 'express';
import express from 'express';
import { saveUpload, MAX_UPLOAD_BYTES } from '../../core/upload';

/**
 * 文件上传路由。
 * POST /api/files/upload?name=原始文件名 —— body 为文件原始字节(application/octet-stream)。
 * 返回 { path }(服务端暂存路径),前端以 path 模式附件引用,注入时后端安全读取/提取。
 * 大小限制 50MB(express.raw limit),扩展名黑名单由 saveUpload 内安全策略校验。
 */
export function registerFiles(r: Router): void {
  // 只对 /files/upload 放宽 body 限制(其余 JSON 路由仍受 2mb 保护,防大 payload DoS)
  r.post('/files/upload',
    express.raw({ type: ['application/octet-stream', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'], limit: MAX_UPLOAD_BYTES }),
    (req: Request, res: Response) => {
      try {
        // Express query parser 已自动解码 URL 编码,name 直接可用(手动再 decode 会对含 % 的文件名抛 URI malformed)
        const name = typeof req.query.name === 'string' ? req.query.name.trim() : '';
        if (!name) return res.status(400).json({ error: 'name 参数必填(原始文件名)' });
        if (!(req.body instanceof Buffer) || req.body.length === 0) {
          return res.status(400).json({ error: '请求体必须是文件字节' });
        }
        const up = saveUpload(req.body, name);
        // 返回暂存路径(绝对路径),前端作为 path 附件回传
        res.json({ ok: true, path: up.storedPath, name: up.name, size: up.size });
      } catch (err: any) {
        res.status(400).json({ error: err.message || '上传失败' });
      }
    });

  // 诊断信息:上传目录 + 上限(设置页可展示)
  r.get('/files/upload-config', (_req: Request, res: Response) => {
    res.json({ maxBytes: MAX_UPLOAD_BYTES, maxBytesMB: Math.round(MAX_UPLOAD_BYTES / 1024 / 1024) });
  });
}
