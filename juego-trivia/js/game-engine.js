/**
 * PorkCasare Trivia - Game Engine
 * Motor del juego que maneja la logica principal de la Trivia
 */

// Banco de preguntas por categoria
export const QUESTIONS_BANK = {
  productos: [
    { q: "Cual es el corte de cerdo mas magro?", options: ["Lomo de cerdo", "Tocino", "Costillas", "Chicharron"], answer: 0 },
    { q: "Cual es la temperatura interna segura para cocinar cerdo?", options: ["63 C (145 F)", "50 C (122 F)", "80 C (176 F)", "100 C (212 F)"], answer: 0 },
    { q: "Que vitamina es abundante en la carne de cerdo?", options: ["Vitamina B1 (Tiamina)", "Vitamina C", "Vitamina A", "Vitamina K"], answer: 0 },
    { q: "Cual es el metodo de conservacion mas antiguo para la carne?", options: ["Salado/Curado", "Refrigeracion", "Enlatado", "Liofilizacion"], answer: 0 },
    { q: "Que parte del cerdo se usa para hacer jamon?", options: ["Pierna trasera", "Lomo", "Costillas", "Cabeza"], answer: 0 },
    { q: "Cuantos gramos de proteina tiene 100g de lomo de cerdo?", options: ["Aprox. 26g", "Aprox. 10g", "Aprox. 40g", "Aprox. 5g"], answer: 0 },
    { q: "Que mineral esencial se encuentra en la carne de cerdo?", options: ["Zinc", "Calcio", "Sodio", "Potasio"], answer: 0 },
    { q: "Cual es el pais mayor productor de carne de cerdo?", options: ["China", "Colombia", "Brasil", "Argentina"], answer: 0 },
    { q: "Que es la marmoracion en la carne?", options: ["Grasa intramuscular", "Un tipo de corte", "Un condimento", "Una enfermedad"], answer: 0 },
    { q: "Cual es el tiempo recomendado de reposo de la carne despues de cocinar?", options: ["3-5 minutos", "30 minutos", "No necesita reposo", "1 hora"], answer: 0 }
  ],
  nutricion: [
    { q: "Cuantas calorias tiene aprox. 100g de pechuga de pollo?", options: ["165 calorias", "300 calorias", "50 calorias", "450 calorias"], answer: 0 },
    { q: "Que macronutriente proporciona la mayor energia por gramo?", options: ["Grasas (9 cal/g)", "Proteinas (4 cal/g)", "Carbohidratos (4 cal/g)", "Fibra (2 cal/g)"], answer: 0 },
    { q: "Cuantos vasos de agua se recomienda beber al dia?", options: ["8 vasos (2 litros)", "2 vasos", "15 vasos", "1 vaso"], answer: 0 },
    { q: "Que alimento es rico en omega-3?", options: ["Salmon", "Arroz", "Papa", "Lechuga"], answer: 0 },
    { q: "Cual es la funcion principal de las proteinas?", options: ["Construir y reparar tejidos", "Solo dar energia", "Producir grasa", "Regular la temperatura"], answer: 0 },
    { q: "Que vitamina se produce con la exposicion al sol?", options: ["Vitamina D", "Vitamina C", "Vitamina B12", "Vitamina E"], answer: 0 },
    { q: "Cual es un alimento rico en fibra?", options: ["Avena", "Mantequilla", "Huevos", "Leche"], answer: 0 },
    { q: "Que mineral es esencial para los huesos?", options: ["Calcio", "Hierro", "Zinc", "Cobre"], answer: 0 },
    { q: "Cuantos gramos de proteina diaria necesita un adulto promedio?", options: ["50-60 gramos", "10 gramos", "150 gramos", "5 gramos"], answer: 0 },
    { q: "Que alimento es una fuente completa de proteina?", options: ["Huevos", "Arroz", "Manzana", "Pan blanco"], answer: 0 }
  ],
  empresa: [
    { q: "Que significa PorkCasare en la plataforma?", options: ["Distribucion de productos de cerdo y hogar", "Solo venta de cerdo", "Una red social", "Un juego en linea"], answer: 0 },
    { q: "Cual es el modelo de negocio de PorkCasare?", options: ["Distribucion multinivel", "Venta al detal", "Franquicia", "Solo e-commerce"], answer: 0 },
    { q: "Que beneficio obtiene un distribuidor al invitar referidos?", options: ["Comisiones por niveles", "Solo descuentos", "Nada", "Un salario fijo"], answer: 0 },
    { q: "Cuantos niveles de profundidad tiene el plan de compensacion?", options: ["5 niveles", "2 niveles", "10 niveles", "Sin limite"], answer: 0 },
    { q: "Que herramienta usa PorkCasare para gestionar pedidos?", options: ["Oficina Virtual", "WhatsApp solo", "Llamadas telefonicas", "Correo postal"], answer: 0 },
    { q: "Que categorias de productos ofrece PorkCasare?", options: ["Carnes, aseo, bebidas, alimentos y mas", "Solo carnes", "Solo limpieza", "Solo bebidas"], answer: 0 },
    { q: "Como se ganan puntos en la plataforma?", options: ["Comprando productos y jugando retos", "Solo registrandose", "Enviando mensajes", "Viendo publicidad"], answer: 0 },
    { q: "Que significa PEC en la plataforma?", options: ["Paquete Educativo de Consumo", "Punto de Entrega Central", "Plan Empresarial Comercial", "Programa Extra de Calidad"], answer: 0 },
    { q: "Cual es la moneda de la plataforma para juegos?", options: ["Monedas (coins)", "Dolares", "Bitcoin", "Estrellas"], answer: 0 },
    { q: "Que tipo de estructura de red usa PorkCasare?", options: ["Red unilevel", "Piramide", "Binaria", "Matriz forzada"], answer: 0 }
  ],
  general: [
    { q: "Que es la cadena de frio en alimentos?", options: ["Mantener temperatura controlada del productor al consumidor", "Cocinar a baja temperatura", "Congelar y descongelar repetidamente", "Un tipo de receta"], answer: 0 },
    { q: "Cual es la mejor forma de descongelar carne?", options: ["En el refrigerador", "A temperatura ambiente", "En agua caliente", "En el microondas siempre"], answer: 0 },
    { q: "Que significa HACCP en seguridad alimentaria?", options: ["Analisis de Peligros y Puntos Criticos de Control", "Alimentos Certificados", "Norma de Calidad Premium", "Control de Precios"], answer: 0 },
    { q: "Cuanto tiempo puede durar la carne de cerdo refrigerada?", options: ["3-5 dias", "30 dias", "1 dia", "1 ano"], answer: 0 },
    { q: "Que es la pasteurizacion?", options: ["Calentar para eliminar patogenos", "Congelar alimentos", "Un tipo de corte", "Agregar conservantes"], answer: 0 },
    { q: "Cual es el pH neutro?", options: ["7", "0", "14", "3"], answer: 0 },
    { q: "Que bacteria es comun en carne mal cocida?", options: ["Salmonella", "Lactobacillus", "Levadura", "Penicillium"], answer: 0 },
    { q: "Que es el valor biologico de una proteina?", options: ["Porcentaje de proteina absorbida y utilizada", "Su precio en el mercado", "Su color", "Su sabor"], answer: 0 },
    { q: "Cual es un antioxidante natural?", options: ["Vitamina E", "Sal", "Azucar", "Harina"], answer: 0 },
    { q: "Que es el indice glucemico?", options: ["Velocidad con que un alimento eleva la glucosa", "Cantidad de grasa", "Nivel de proteinas", "Contenido de agua"], answer: 0 }
  ]
};

export const CATEGORIES = [
  { id: 'productos', name: 'Productos', icon: '&#x1F969;', color: '#e74c3c', description: 'Sobre cortes, preparacion y conservacion' },
  { id: 'nutricion', name: 'Nutricion', icon: '&#x1F34E;', color: '#27ae60', description: 'Vitaminas, minerales y alimentacion saludable' },
  { id: 'empresa', name: 'PorkCasare', icon: '&#x1F437;', color: '#7be495', description: 'Sobre la plataforma y el plan de negocio' },
  { id: 'general', name: 'General', icon: '&#x1F4DA;', color: '#4a90d9', description: 'Conocimiento general sobre alimentos' }
];

// Configuracion del juego
export const GAME_CONFIG = {
  questionsPerRound: 10,
  timePerQuestion: 30, // segundos
  pointsPerCorrect: 100,
  streakBonus: 25,      // puntos extra por racha
  timeBonus: 3,         // puntos extra por segundo restante
  coinsPerCorrect: 5,
  perfectBonus: 50,     // bonus por ronda perfecta
  fiftyFiftyUses: 2,
  skipUses: 1,
  extraTimeUses: 1,
  extraTimeAmount: 15
};

// Estado del juego
export class TriviaGameState {
  constructor() {
    this.reset();
  }

  reset() {
    this.category = null;
    this.questions = [];
    this.currentQuestionIndex = 0;
    this.score = 0;
    this.correctAnswers = 0;
    this.streak = 0;
    this.maxStreak = 0;
    this.lives = 5;
    this.coins = 0;
    this.timeRemaining = 0;
    this.isPlaying = false;
    this.totalScore = 0;
    this.gamesPlayed = 0;
    this.fiftyFiftyRemaining = GAME_CONFIG.fiftyFiftyUses;
    this.skipRemaining = GAME_CONFIG.skipUses;
    this.extraTimeRemaining = GAME_CONFIG.extraTimeUses;
    this.answeredQuestions = [];
  }
}

// Motor del juego
export class TriviaGameEngine {
  constructor() {
    this.state = new TriviaGameState();
    this.timerInterval = null;
    this.onStateChange = null;
    this.onTimeUp = null;
    this.onCorrectAnswer = null;
    this.onWrongAnswer = null;
    this.onRoundComplete = null;
    this.onGameOver = null;
    this.firebaseHandler = null; // Referencia al handler para limite mensual
  }

  // Establecer referencia al firebase handler
  setFirebaseHandler(handler) {
    this.firebaseHandler = handler;
  }

  // Seleccionar categoria y preparar preguntas
  selectCategory(categoryId) {
    const questions = QUESTIONS_BANK[categoryId];
    if (!questions) return false;

    this.state.category = categoryId;

    // Mezclar y seleccionar preguntas
    const shuffled = [...questions].sort(() => Math.random() - 0.5);
    this.state.questions = shuffled.slice(0, GAME_CONFIG.questionsPerRound).map(q => {
      // Mezclar opciones manteniendo referencia a la correcta
      const correctAnswer = q.options[q.answer];
      const shuffledOptions = [...q.options].sort(() => Math.random() - 0.5);
      const newAnswerIndex = shuffledOptions.indexOf(correctAnswer);
      return { ...q, options: shuffledOptions, answer: newAnswerIndex };
    });

    this.state.currentQuestionIndex = 0;
    this.state.score = 0;
    this.state.correctAnswers = 0;
    this.state.streak = 0;
    this.state.maxStreak = 0;
    this.state.answeredQuestions = [];
    this.state.fiftyFiftyRemaining = GAME_CONFIG.fiftyFiftyUses;
    this.state.skipRemaining = GAME_CONFIG.skipUses;
    this.state.extraTimeRemaining = GAME_CONFIG.extraTimeUses;

    this.notifyStateChange();
    return true;
  }

  // Iniciar ronda
  startRound() {
    if (this.state.lives <= 0) return false;
    this.state.isPlaying = true;
    this.state.timeRemaining = GAME_CONFIG.timePerQuestion;
    this.startTimer();
    this.notifyStateChange();
    return true;
  }

  // Obtener pregunta actual
  getCurrentQuestion() {
    if (this.state.currentQuestionIndex >= this.state.questions.length) return null;
    return this.state.questions[this.state.currentQuestionIndex];
  }

  // Responder pregunta
  answerQuestion(selectedIndex) {
    if (!this.state.isPlaying) return null;
    this.stopTimer();

    const question = this.getCurrentQuestion();
    if (!question) return null;

    const isCorrect = selectedIndex === question.answer;

    let pointsEarned = 0;
    let coinsEarned = 0;

    if (isCorrect) {
      this.state.streak++;
      if (this.state.streak > this.state.maxStreak) {
        this.state.maxStreak = this.state.streak;
      }
      this.state.correctAnswers++;

      pointsEarned = GAME_CONFIG.pointsPerCorrect;
      pointsEarned += (this.state.streak - 1) * GAME_CONFIG.streakBonus;
      pointsEarned += this.state.timeRemaining * GAME_CONFIG.timeBonus;

      // Aplicar limite mensual a las monedas
      let rawCoins = GAME_CONFIG.coinsPerCorrect;
      if (this.firebaseHandler) {
        coinsEarned = this.firebaseHandler.applyMonthlyLimit(rawCoins);
        if (coinsEarned > 0) this.firebaseHandler.addMonthlyCoins(coinsEarned);
      } else {
        coinsEarned = rawCoins;
      }

      this.state.score += pointsEarned;
      this.state.coins += coinsEarned;

      if (this.onCorrectAnswer) {
        this.onCorrectAnswer({ pointsEarned, coinsEarned, streak: this.state.streak });
      }
    } else {
      this.state.streak = 0;
      // Penalty for wrong answer
      const penalty = 5;
      const actualPenalty = Math.min(penalty, this.state.coins);
      this.state.coins -= actualPenalty;
      coinsEarned = -actualPenalty;

      if (this.onWrongAnswer) {
        this.onWrongAnswer({ correctIndex: question.answer, penalty: actualPenalty });
      }
    }

    this.state.answeredQuestions.push({
      questionIndex: this.state.currentQuestionIndex,
      selectedIndex,
      isCorrect,
      pointsEarned
    });

    this.notifyStateChange();

    return { isCorrect, correctIndex: question.answer, pointsEarned, coinsEarned };
  }

  // Siguiente pregunta
  nextQuestion() {
    this.state.currentQuestionIndex++;

    if (this.state.currentQuestionIndex >= this.state.questions.length) {
      this.roundComplete();
      return false;
    }

    this.state.timeRemaining = GAME_CONFIG.timePerQuestion;
    this.startTimer();
    this.notifyStateChange();
    return true;
  }

  // Usar 50/50
  useFiftyFifty() {
    if (this.state.fiftyFiftyRemaining <= 0 || !this.state.isPlaying) return null;

    const question = this.getCurrentQuestion();
    if (!question) return null;

    this.state.fiftyFiftyRemaining--;

    // Encontrar 2 opciones incorrectas para eliminar
    const incorrectIndices = [];
    for (let i = 0; i < question.options.length; i++) {
      if (i !== question.answer) incorrectIndices.push(i);
    }
    const shuffled = incorrectIndices.sort(() => Math.random() - 0.5);
    const toRemove = shuffled.slice(0, 2);

    this.notifyStateChange();
    return toRemove;
  }

  // Saltar pregunta
  useSkip() {
    if (this.state.skipRemaining <= 0 || !this.state.isPlaying) return false;
    this.state.skipRemaining--;
    this.stopTimer();

    this.state.answeredQuestions.push({
      questionIndex: this.state.currentQuestionIndex,
      selectedIndex: -1,
      isCorrect: false,
      pointsEarned: 0,
      skipped: true
    });

    return this.nextQuestion();
  }

  // Agregar tiempo extra
  useExtraTime() {
    if (this.state.extraTimeRemaining <= 0 || !this.state.isPlaying) return false;
    this.state.extraTimeRemaining--;
    this.state.timeRemaining += GAME_CONFIG.extraTimeAmount;
    this.notifyStateChange();
    return true;
  }

  // Ronda completada
  roundComplete() {
    this.stopTimer();
    this.state.isPlaying = false;
    this.state.gamesPlayed++;

    const totalQuestions = this.state.questions.length;
    const correctRatio = this.state.correctAnswers / totalQuestions;

    let bonusCoins = 0;
    if (correctRatio === 1) {
      bonusCoins = GAME_CONFIG.perfectBonus;
    }

    let scoreBonusCoins = Math.floor(this.state.score / 20);

    // Aplicar limite mensual a los bonus
    if (this.firebaseHandler) {
      bonusCoins = this.firebaseHandler.applyMonthlyLimit(bonusCoins);
      if (bonusCoins > 0) this.firebaseHandler.addMonthlyCoins(bonusCoins);
      scoreBonusCoins = this.firebaseHandler.applyMonthlyLimit(scoreBonusCoins);
      if (scoreBonusCoins > 0) this.firebaseHandler.addMonthlyCoins(scoreBonusCoins);
    }

    this.state.coins += bonusCoins;
    this.state.coins += scoreBonusCoins;
    this.state.totalScore += this.state.score;

    let stars = 0;
    if (correctRatio >= 0.9) stars = 3;
    else if (correctRatio >= 0.7) stars = 2;
    else if (correctRatio >= 0.5) stars = 1;

    const result = {
      score: this.state.score,
      correctAnswers: this.state.correctAnswers,
      totalQuestions,
      maxStreak: this.state.maxStreak,
      coinsEarned: bonusCoins + scoreBonusCoins,
      stars,
      isPerfect: correctRatio === 1
    };

    if (this.onRoundComplete) {
      this.onRoundComplete(result);
    }

    return result;
  }

  // Tiempo agotado
  timeUp() {
    this.stopTimer();
    this.state.streak = 0;
    // Penalty for time expiry
    const penalty = 3;
    const actualPenalty = Math.min(penalty, this.state.coins);
    this.state.coins -= actualPenalty;

    this.state.answeredQuestions.push({
      questionIndex: this.state.currentQuestionIndex,
      selectedIndex: -1,
      isCorrect: false,
      pointsEarned: 0,
      timedOut: true
    });

    if (this.onTimeUp) {
      const question = this.getCurrentQuestion();
      this.onTimeUp({ correctIndex: question ? question.answer : -1 });
    }

    this.notifyStateChange();
  }

  // Timer
  startTimer() {
    this.stopTimer();
    this.timerInterval = setInterval(() => {
      this.state.timeRemaining--;

      if (this.state.timeRemaining <= 0) {
        this.state.timeRemaining = 0;
        this.timeUp();
      }

      this.notifyStateChange();
    }, 1000);
  }

  stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  // Formatear tiempo
  formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  notifyStateChange() {
    if (this.onStateChange) {
      this.onStateChange(this.getState());
    }
  }

  getState() {
    return {
      ...this.state,
      currentQuestion: this.getCurrentQuestion(),
      progress: this.state.questions.length > 0
        ? ((this.state.currentQuestionIndex) / this.state.questions.length) * 100
        : 0,
      timeFormatted: this.formatTime(this.state.timeRemaining)
    };
  }

  // Cargar/guardar estado
  loadState(savedState) {
    if (savedState) {
      this.state.lives = savedState.lives ?? 5;
      this.state.coins = savedState.coins ?? 0;
      this.state.totalScore = savedState.totalScore ?? 0;
      this.state.gamesPlayed = savedState.gamesPlayed ?? 0;
      this.notifyStateChange();
    }
  }

  getSaveState() {
    return {
      lives: this.state.lives,
      coins: this.state.coins,
      totalScore: this.state.totalScore,
      gamesPlayed: this.state.gamesPlayed
    };
  }
}

export default TriviaGameEngine;
