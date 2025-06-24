// server.js
const express = require('express');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const slugify = require('slugify');
const basicAuth = require('basic-auth');

const app = express();
const PORT = 3000;

// Auth config
const ADMIN_USER = 'admin';
const ADMIN_PASS = 'motdepasse123';

const auth = (req, res, next) => {
  const user = basicAuth(req);
  if (user && user.name === ADMIN_USER && user.pass === ADMIN_PASS) {
    return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Admin Area"');
  return res.status(401).send('Authentification requise');
};

// PROTECTION DE LA PAGE ADMIN AVANT express.static
app.get('/admin.html', auth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});
app.use('/admin', auth);

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// Multer config pour upload image avec normalisation du nom
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'public', 'images');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const baseName = path.basename(file.originalname, ext);
    const normalized = slugify(baseName, { lower: true, strict: true }) + '-' + Date.now() + ext;
    cb(null, normalized);
  }
});
const upload = multer({ storage });

const tombolaPath = path.join(__dirname, 'json', 'tombolas.json');
const currentPath = path.join(__dirname, 'json', 'current_tombola.json');

// Upload image
app.post('/admin/upload-image', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).send('Aucun fichier reçu');
  res.status(200).json({ filename: req.file.filename });
});

// Récupérer la tombola actuelle
app.get('/api/tombola', (req, res) => {
  if (!fs.existsSync(currentPath)) return res.json({});
  fs.readFile(currentPath, 'utf8', (err, data) => {
    if (err) return res.status(500).json({ error: 'Erreur serveur' });
    res.json(JSON.parse(data));
  });
});

// Participer à la tombola
app.post('/participate', (req, res) => {
  const { full_name, email, phone } = req.body;
  if (!full_name || !email || !phone) {
    return res.status(400).send('Tous les champs sont obligatoires');
  }

  const current = JSON.parse(fs.readFileSync(currentPath));
  const participantFile = path.join(__dirname, 'json', `participants_${current.id}.json`);
  let participants = [];

  if (fs.existsSync(participantFile)) {
    participants = JSON.parse(fs.readFileSync(participantFile));
    const alreadyExists = participants.some(p => p.email === email);
    if (alreadyExists) {
      return res.status(409).send('Vous avez déjà participé à cette tombola');
    }
  }

  const newParticipant = {
    id: uuidv4(),
    tombola_id: current.id,
    full_name: full_name.trim(),
    email: email.trim(),
    phone: phone.trim(),
    timestamp: new Date().toISOString()
  };

  participants.push(newParticipant);
  fs.writeFileSync(participantFile, JSON.stringify(participants, null, 2));
  res.send('Participation enregistrée !');
});

// Créer une nouvelle tombola
app.post('/admin/create-tombola', (req, res) => {
  const { title, description, start_date, end_date, image_url } = req.body;
  if (!title || !description || !start_date || !end_date || !image_url) {
    return res.status(400).send('Champs manquants');
  }

  const newId = Date.now();
  const newTombola = {
    id: newId,
    title,
    description,
    start_date,
    end_date,
    image_url,
    active: true,
    closed: false
  };

  fs.writeFileSync(currentPath, JSON.stringify(newTombola, null, 2));

  let tombolas = [];
  if (fs.existsSync(tombolaPath)) {
    tombolas = JSON.parse(fs.readFileSync(tombolaPath));
  }
  tombolas.unshift({ ...newTombola });
  fs.writeFileSync(tombolaPath, JSON.stringify(tombolas, null, 2));

  const participantsPath = path.join(__dirname, 'json', `participants_${newId}.json`);
  fs.writeFileSync(participantsPath, '[]');

  res.send('Nouvelle tombola créée !');
});

// Liste des tombolas
app.get('/api/tombolas', (req, res) => {
  const tombolas = JSON.parse(fs.readFileSync(tombolaPath));
  res.json(tombolas);
});

// Participants d'une tombola
app.get('/api/participants/:id', (req, res) => {
  const id = req.params.id;
  const filePath = path.join(__dirname, 'json', `participants_${id}.json`);
  if (!fs.existsSync(filePath)) return res.status(404).json([]);
  const participants = JSON.parse(fs.readFileSync(filePath));
  res.json(participants);
});

// Tirer un gagnant
app.post('/admin/draw/:id', (req, res) => {
  const tombolaId = req.params.id;
  const participantsPath = path.join(__dirname, 'json', `participants_${tombolaId}.json`);
  const winnerPath = path.join(__dirname, 'json', `winner_${tombolaId}.json`);

  if (!fs.existsSync(participantsPath)) return res.status(404).send("Aucun participant trouvé");
  const participants = JSON.parse(fs.readFileSync(participantsPath));
  if (participants.length === 0) return res.status(400).send("Aucun participant");

  const winner = participants[Math.floor(Math.random() * participants.length)];
  fs.writeFileSync(winnerPath, JSON.stringify({
    tombola_id: tombolaId,
    winner_id: winner.id,
    timestamp: new Date().toISOString()
  }, null, 2));

  let tombolas = JSON.parse(fs.readFileSync(tombolaPath));
  tombolas = tombolas.map(t => {
    if (String(t.id) === tombolaId) return { ...t, winner_id: winner.id };
    return t;
  });
  fs.writeFileSync(tombolaPath, JSON.stringify(tombolas, null, 2));

  res.send(`Le gagnant est : ${winner.full_name} (${winner.email})`);
});

// Fermer une tombola
app.post('/admin/close-tombola/:id', (req, res) => {
  const tombolaId = req.params.id;
  let tombolas = JSON.parse(fs.readFileSync(tombolaPath));
  const current = fs.existsSync(currentPath) ? JSON.parse(fs.readFileSync(currentPath)) : null;

  let updated = false;
  tombolas = tombolas.map(t => {
    if (String(t.id) === tombolaId) {
      t.closed = true;
      t.active = false;
      updated = true;
    }
    return t;
  });

  if (!updated) return res.status(404).send("Tombola non trouvée");

  fs.writeFileSync(tombolaPath, JSON.stringify(tombolas, null, 2));

  if (current && String(current.id) === tombolaId) {
    fs.unlinkSync(currentPath);
  }

  res.send("Tombola fermée avec succès !");
});

app.listen(PORT, () => {
  console.log(`vd-tombola tourne sur http://localhost:${PORT}`);
});
