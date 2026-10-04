// নাম _ দিয়ে শুরু হলে লোড হয় না। চালু করতে ফাইলের নাম বদলান, যেমন: mybot.js
// এখানে নিজের যেকোনো রুট/বট/সফটওয়্যার লিখতে পারবেন।
module.exports = ({ app, store, BASE }) => {
  app.get('/hello', (req, res) => res.send('হ্যালো! আমার কাস্টম রুট চলছে।'));

  // উদাহরণ: আরেকটি Telegram বট (আলাদা টোকেনসহ)
  // const TOKEN = process.env.BOT2_TOKEN;
  // app.post('/bot2', (req, res) => { res.sendStatus(200); /* req.body এ মেসেজ */ });
};
