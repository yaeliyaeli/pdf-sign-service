// server.js
require('dotenv').config();
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const libre = require('libreoffice-convert');
const { v4: uuidv4 } = require('uuid');
const { PDFDocument } = require('pdf-lib');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

// יצירת תיקיית uploads אם לא קיימת
if (!fs.existsSync('./uploads')) fs.mkdirSync('./uploads');

// Middleware
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Multer storage
const storage = multer.diskStorage({
  destination: './uploads',
  filename: (req, file, cb) => {
    cb(null, uuidv4() + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowedExt = /doc|docx/;
    const ext = path.extname(file.originalname).toLowerCase();
    const mime = file.mimetype;
    if (
      allowedExt.test(ext) &&
      (mime === 'application/msword' ||
       mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    ) {
      cb(null, true);
    } else {
      cb(new Error('רק קבצי Word מותרים'));
    }
  }
});

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/upload', (req, res) => {
  upload.single('wordFile')(req, res, async (err) => {
    if (err) return res.status(400).send(err.message);

    const fileId = req.file.filename;
    const docxPath = path.join(__dirname, 'uploads', fileId);
    const pdfPath = path.join(__dirname, 'uploads', fileId + '.pdf');

    // Convert DOCX to PDF
    const docxBuf = fs.readFileSync(docxPath);
    libre.convert(docxBuf, '.pdf', undefined, (err, done) => {
      if (err) return res.status(500).send('שגיאה בהמרת קובץ ל-PDF');
      fs.writeFileSync(pdfPath, done);
      const link = `/sign/${fileId}.pdf`;
      res.send(`<p>המסמך הומר ל-PDF! לחתום כאן:</p><a href="${link}">${link}</a>`);
    });
  });
});

app.get('/sign/:pdfFile', (req, res) => {
  const pdfFile = req.params.pdfFile;
  res.send(`
    <html lang="he">
      <head>
        <meta charset="UTF-8"/>
        <title>חתימה דיגיטלית</title>
        <style>
          #signature { border: 2px solid black; border-radius: 8px; touch-action: none; }
          iframe { width: 600px; height: 400px; border: 1px solid #ccc; }
        </style>
        <script src="https://cdn.jsdelivr.net/npm/signature_pad@4.1.5/dist/signature_pad.umd.min.js"></script>
      </head>
      <body>
        <h2>המסמך ל-PDF</h2>
        <iframe src="/uploads/${pdfFile}"></iframe>
        <h3>חתום כאן עם העכבר או האצבע</h3>
        <canvas id="signature" width="600" height="200"></canvas><br/>
        <button onclick="clearSig()">נקה חתימה</button>
        <form method="POST" action="/sign/${pdfFile}">
          <input type="hidden" name="signatureData" id="signatureData"/>
          <button type="submit" onclick="prepareSig(event)">חתום ושלח</button>
        </form>

        <script>
          const canvas = document.getElementById('signature');
          const signaturePad = new SignaturePad(canvas, {minWidth: 1, maxWidth: 2.5, penColor: 'black'});
          function clearSig() { signaturePad.clear(); }
          function prepareSig(e) {
            if (signaturePad.isEmpty()) {
              alert('אנא חתום לפני השליחה!');
              e.preventDefault();
            } else {
              document.getElementById('signatureData').value = signaturePad.toDataURL();
            }
          }
        </script>
      </body>
    </html>
  `);
});

app.post('/sign/:pdfFile', async (req, res) => {
  try {
    const pdfFile = req.params.pdfFile;
    const pdfPath = path.join(__dirname, 'uploads', pdfFile);
    const { signatureData } = req.body;

    const existingPdfBytes = fs.readFileSync(pdfPath);
    const pdfDoc = await PDFDocument.load(existingPdfBytes);
    const pages = pdfDoc.getPages();
    const lastPage = pages[pages.length - 1];

    const signatureBuffer = Buffer.from(signatureData.replace(/^data:image\/png;base64,/, ''), 'base64');
    const pngImage = await pdfDoc.embedPng(signatureBuffer);

    const { width, height } = lastPage.getSize();
    lastPage.drawImage(pngImage, { x: width - 220, y: 50, width: 150, height: 75 });

    const pdfBytes = await pdfDoc.save();
    const signedPdfPath = path.join(__dirname, 'uploads', 'signed_' + pdfFile);
    fs.writeFileSync(signedPdfPath, pdfBytes);

    // שליחת מייל
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});


    await transporter.sendMail({
      from: `"PDF Sign Service" <${process.env.EMAIL_USER}>`,
      to: process.env.EMAIL_USER,
      subject: `קובץ נחתם: ${pdfFile}`,
      text: 'המסמך נחתם דיגיטלית ונשלח אליך',
      attachments: [{ filename: 'signed_' + pdfFile, path: signedPdfPath }]
    });

    res.send('הקובץ נחתם בהצלחה ונשלח למייל!');
  } catch (err) {
    console.error(err);
    res.status(500).send('אירעה שגיאה בחתימה');
  }
});

// הפעלת השרת
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
