import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ message: 'LexnaVe Backend funcionando' });
});

app.post('/api/consultar', async (req, res) => {
  const { pregunta } = req.body;
  console.log("Pregunta:", pregunta);
  res.json({ respuesta: "Procesando: " + pregunta, articulos: [] });
});

app.listen(PORT, () => {
  console.log(`Backend en puerto ${PORT}`);
});
