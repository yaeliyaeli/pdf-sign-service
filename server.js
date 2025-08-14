require('dotenv').config();
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { Document, Packer, Paragraph, ImageRun } = require('docx');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// תיקיית uploads
if (!fs.existsSync('./uploads')) fs.mkdirSync('./uploads');

// Middleware
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Multer לאחסון קבצים
const storage = multer.diskStorage({
  destination: './uploads',
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.docx') cb(null, true);
    else cb(new Error('רק קבצי Word מותרים'));
  }
});

// דף ראשי עם טופס העלאה
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// העלאת Word
app.post('/upload', upload.single('wordFile'), (req, res) => {
  const filename = req.file.filename;
  res.redirect(`/sign/${filename}`);
});

// דף חתימה
app.get('/sign/:wordFile', (req, res) => {
  const wordFile = req.params.wordFile;
  res.send(`
    <html lang="he">
      <head>
        <meta charset="UTF-8"/>
        <title>חתימה על Word</title>
        <script src="https://cdn.jsdelivr.net/npm/signature_pad@4.1.5/dist/signature_pad.umd.min.js"></script>
      </head>
      <body>
        <h2>קובץ Word לחתימה</h2>
        <p>${wordFile}</p>
        <canvas id="signature" width="600" height="200" style="border:1px solid black;"></canvas><br/>
        <button onclick="clearSig()">נקה חתימה</button>
        <form method="POST" action="/sign/${wordFile}">
          <input type="hidden" name="signatureData" id="signatureData"/>
          <button type="submit" onclick="prepareSig(event)">חתום ושמור</button>
        </form>
        <script>
          const canvas = document.getElementById('signature');
          const signaturePad = new SignaturePad(canvas, { minWidth: 1, maxWidth: 2.5 });
          function clearSig() { signaturePad.clear(); }
          function prepareSig(e) {
            if(signaturePad.isEmpty()) { alert('אנא חתום לפני השליחה'); e.preventDefault(); }
            else { document.getElementById('signatureData').value = signaturePad.toDataURL(); }
          }
        </script>
      </body>
    </html>
  `);
});

// שמירת החתימה ל-Word חדש
app.post('/sign/:wordFile', async (req, res) => {
  try {
    const wordFile = req.params.wordFile;
    const { signatureData } = req.body;

    const signatureBuffer = Buffer.from(signatureData.replace(/^data:image\/png;base64,/, ''), 'base64');

    // יוצרים מסמך חדש עם החתימה
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph('חתימה דיגיטלית:'),
            new Paragraph({
              children: [new ImageRun({ data: signatureBuffer, transformation: { width: 300, height: 150 } })]
            })
          ]
        }
      ]
    });

    const newWordPath = path.join(__dirname, 'uploads', 'signed_' + wordFile);
    const buffer = await Packer.toBuffer(doc);
    fs.writeFileSync(newWordPath, buffer);

    res.send(`הקובץ נחתם! <a href="/uploads/signed_${wordFile}">לחץ כאן להורדה</a>`);
  } catch (err) {
    console.error(err);
    res.status(500).send('אירעה שגיאה בחתימה');
  }
});

app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
