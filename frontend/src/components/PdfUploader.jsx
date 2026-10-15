import {useLanguage} from '../i18n.jsx';
import React from 'react';
import { Upload } from 'antd';
import { InboxOutlined } from '@ant-design/icons';
export default function PdfUploader({ busy, onUpload }) {
  const {t}=useLanguage();
  return <Upload.Dragger accept=".pdf,application/pdf" multiple={false} disabled={busy} showUploadList={false} beforeUpload={file => { onUpload(file); return false; }}>
    <p className="ant-upload-drag-icon"><InboxOutlined /></p>
    <p className="ant-upload-text">{t('uploadTitle')}</p>
    <p className="ant-upload-hint">{t('uploadHint')}</p>
  </Upload.Dragger>;
}
