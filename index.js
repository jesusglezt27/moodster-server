const express = require('express');
const cors = require('cors');
const passport = require('passport');
const SpotifyStrategy = require('passport-spotify').Strategy;
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json()); // Necesario para parsear el cuerpo de las solicitudes POST

app.use(cors({
    origin: 'http://localhost:3000' // Asegúrate de que este es el origen de tu frontend
  }));

passport.use(new SpotifyStrategy({
    clientID: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    callbackURL: 'http://localhost:3000/callback'
  },
  (accessToken, refreshToken, expires_in, profile, done) => {
    // Aquí puedes manejar el perfil del usuario y los tokens si es necesario
    done(null, profile);
  }
));

app.get('/login', passport.authenticate('spotify', {
    scope: ['user-read-email', 'user-read-private', 'playlist-modify-public', 'playlist-modify-private', 'user-top-read'],
    showDialog: true
}));

// Esta ruta maneja el intercambio del 'code' por un 'token' de acceso
app.post('/exchange_code', async (req, res) => {
  const { code } = req.body;
  try {
    const response = await axios({
      method: 'post',
      url: 'https://accounts.spotify.com/api/token',
      data: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: 'http://localhost:3000/callback',
        client_id: process.env.SPOTIFY_CLIENT_ID,
        client_secret: process.env.SPOTIFY_CLIENT_SECRET,
      }).toString(),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    const accessToken = response.data.access_token;
    res.json({ accessToken: accessToken });
  } catch (error) {
    console.error('Error exchanging code for token:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Redirige a esta ruta después de que Spotify autentica al usuario
app.get('/callback', passport.authenticate('spotify', { failureRedirect: '/login' }),
  (req, res) => {
    // No necesitas hacer nada aquí si estás manejando el intercambio de código en el frontend
    res.send('Puede cerrar esta pestaña');
  }
);

app.listen(4000, () => console.log('Servidor corriendo en el puerto 4000'));
