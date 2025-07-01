const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const path = require('path');

// Free AI libraries
const compromise = require('compromise');
const natural = require('natural');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

// Initialize SQLite Database
const dbPath = path.join(__dirname, 'classroom.db');
const db = new sqlite3.Database(dbPath);

// Create tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE,
    teacher_name TEXT,
    class_name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT 1
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS questions (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    student_name TEXT,
    question_text TEXT,
    sentiment TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    upvotes INTEGER DEFAULT 0,
    topic_cluster TEXT,
    FOREIGN KEY (session_id) REFERENCES sessions (id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS sentiments (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    student_id TEXT,
    sentiment_type TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions (id)
  )`);
});

// Free AI Functions
class FreeAI {
  // Simple keyword extraction using compromise
  static extractKeywords(text) {
    const doc = compromise(text);
    const nouns = doc.nouns().out('array');
    const verbs = doc.verbs().out('array');
    const adjectives = doc.adjectives().out('array');
    
    return [...nouns, ...verbs, ...adjectives]
      .filter(word => word.length > 2)
      .slice(0, 5); // Top 5 keywords
  }

  // Categorize questions using rule-based approach
  static categorizeQuestion(text) {
    const lowerText = text.toLowerCase();
    
    // Check question words
    if (lowerText.includes('what is') || lowerText.includes('define') || 
        lowerText.includes('meaning') || lowerText.includes('mean')) {
      return 'definition';
    }
    
    if (lowerText.includes('how to') || lowerText.includes('steps') || 
        lowerText.includes('process') || lowerText.includes('procedure')) {
      return 'process';
    }
    
    if (lowerText.includes('why') || lowerText.includes('reason') || 
        lowerText.includes('because') || lowerText.includes('purpose')) {
      return 'reasoning';
    }
    
    if (lowerText.includes('example') || lowerText.includes('instance') || 
        lowerText.includes('case') || lowerText.includes('sample')) {
      return 'examples';
    }
    
    if (lowerText.includes('confused') || lowerText.includes('unclear') || 
        lowerText.includes('understand') || lowerText.includes('explain')) {
      return 'clarification';
    }
    
    return 'general';
  }

  // Find similar questions using Jaccard similarity
  static findSimilarQuestions(newQuestion, existingQuestions) {
    const newKeywords = new Set(this.extractKeywords(newQuestion.toLowerCase()));
    const similarities = [];

    existingQuestions.forEach(existing => {
      const existingKeywords = new Set(this.extractKeywords(existing.question_text.toLowerCase()));
      
      // Jaccard similarity
      const intersection = new Set([...newKeywords].filter(x => existingKeywords.has(x)));
      const union = new Set([...newKeywords, ...existingKeywords]);
      const similarity = intersection.size / union.size;
      
      if (similarity > 0.3) { // 30% similarity threshold
        similarities.push({
          questionId: existing.id,
          similarity: similarity,
          text: existing.question_text
        });
      }
    });

    return similarities.sort((a, b) => b.similarity - a.similarity);
  }

  // Generate topic summary for similar questions
  static generateTopicSummary(questions) {
    if (questions.length === 0) return null;
    
    // Extract all keywords from similar questions
    const allKeywords = [];
    questions.forEach(q => {
      allKeywords.push(...this.extractKeywords(q.question_text));
    });
    
    // Find most common keywords
    const keywordFreq = {};
    allKeywords.forEach(keyword => {
      keywordFreq[keyword] = (keywordFreq[keyword] || 0) + 1;
    });
    
    const topKeywords = Object.entries(keywordFreq)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 3)
      .map(([keyword]) => keyword);
    
    return {
      title: topKeywords.join(' & '),
      keywords: topKeywords,
      questionCount: questions.length,
      urgency: questions.length > 2 ? 'high' : questions.length > 1 ? 'medium' : 'low'
    };
  }
}

// Add this AFTER the existing FreeAI class
const { HfInference } = require('@huggingface/inference');

// Initialize Hugging Face (only if API key exists)
const hf = process.env.HUGGINGFACE_API_KEY ? new HfInference(process.env.HUGGINGFACE_API_KEY) : null;

class EnhancedAI {
  // Smart categorization with kill switch
  static async categorizeQuestion(text) {
    // Check if AI is enabled via environment variable
    const AI_ENABLED = process.env.AI_ENABLED !== 'false';
    
    if (!AI_ENABLED) {
      console.log('🤖 AI disabled via environment variable, using fallback');
      return FreeAI.categorizeQuestion(text);
    }
    
    if (!hf) {
      console.log('🤖 No HF API key, using fallback categorization');
      return FreeAI.categorizeQuestion(text);
    }

    try {
      console.log(`🤖 Analyzing question: "${text}"`);
      
      const result = await hf.zeroShotClassification({
        model: 'facebook/bart-large-mnli',
        inputs: text,
        parameters: {
          candidate_labels: [
            'definition and explanation',
            'process and procedures', 
            'examples and cases',
            'reasoning and why',
            'clarification and confusion',
            'general question'
          ]
        }
      });
      
      const category = result.labels[0].toLowerCase().split(' ')[0];
      const confidence = result.scores[0];
      
      console.log(`🎯 AI Result: ${category} (confidence: ${confidence.toFixed(2)})`);
      return category;
      
    } catch (error) {
      console.error('🚫 LLM categorization failed:', error.message);
      return FreeAI.categorizeQuestion(text); // Fallback
    }
  }

  // Smart sentiment analysis with kill switch
  static async analyzeSentiment(text) {
    // Check if AI is enabled
    const AI_ENABLED = process.env.AI_ENABLED !== 'false';
    
    if (!AI_ENABLED || !hf) {
      return 'neutral'; // Simple fallback
    }

    try {
      const result = await hf.textClassification({
        model: 'cardiffnlp/twitter-roberta-base-sentiment-latest',
        inputs: text
      });
      
      const sentiment = result[0].label.toLowerCase();
      const confidence = result[0].score;
      
      console.log(`😊 Sentiment: ${sentiment} (${confidence.toFixed(2)})`);
      
      if (sentiment === 'negative' && confidence > 0.6) return 'confused';
      if (sentiment === 'positive' && confidence > 0.7) return 'excited'; 
      return 'neutral';
      
    } catch (error) {
      console.error('🚫 Sentiment analysis failed:', error.message);
      return 'neutral';
    }
  }
}

// Generate session codes
function generateSessionCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// REST API Routes
app.get('/api/test', (req, res) => {
  res.json({ 
    message: 'Backend server is running!', 
    timestamp: new Date(),
    ai_status: 'Free AI libraries loaded',
    database: 'SQLite connected'
  });
});

app.post('/api/create-session', (req, res) => {
  const sessionId = uuidv4();
  const sessionCode = generateSessionCode();
  const { teacherName, className } = req.body;

  db.run(
    'INSERT INTO sessions (id, code, teacher_name, class_name) VALUES (?, ?, ?, ?)',
    [sessionId, sessionCode, teacherName, className],
    function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      
      res.json({
        sessionId,
        sessionCode,
        teacherUrl: `http://localhost:3000/teacher/${sessionCode}`,
        studentUrl: `http://localhost:3000/student/${sessionCode}`
      });
    }
  );
});

app.get('/api/session/:code', (req, res) => {
  const { code } = req.params;
  
  db.get('SELECT * FROM sessions WHERE code = ? AND is_active = 1', [code], (err, session) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    res.json(session);
  });
});

// Add this after your existing routes (around line 120)
app.get('/api/debug/questions/:roomId', (req, res) => {
  const { roomId } = req.params;
  
  db.all('SELECT * FROM questions WHERE session_id = ? ORDER BY timestamp DESC', [roomId], (err, questions) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    res.json({
      roomId,
      totalQuestions: questions.length,
      questions: questions
    });
  });
});

// Add endpoint to get all questions in database
app.get('/api/debug/all-questions', (req, res) => {
  db.all('SELECT * FROM questions ORDER BY timestamp DESC LIMIT 50', (err, questions) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    res.json({
      totalQuestions: questions.length,
      questions: questions
    });
  });
});

// Add this route after your existing routes
app.post('/api/clear-session/:roomId', (req, res) => {
  const { roomId } = req.params;
  const { courseName } = req.body;
  
  console.log(`🔄 Clearing session for room ${roomId} (${courseName})`);
  
  // Delete all questions for this room
  db.run('DELETE FROM questions WHERE session_id = ?', [roomId], function(err) {
    if (err) {
      console.error('Error clearing session:', err);
      return res.status(500).json({ error: err.message });
    }
    
    console.log(`✅ Cleared ${this.changes} questions from room ${roomId}`);
    
    // Broadcast to all users in this room that session was cleared
    io.to(roomId).emit('session-cleared', { roomId, courseName });
    
    res.json({ 
      success: true, 
      message: `Session cleared for ${courseName}`,
      questionsRemoved: this.changes 
    });
  });
});

// Add this AFTER your existing routes (around line 150)
app.get('/api/test-models', async (req, res) => {
  const results = {};
  
  if (!hf) {
    return res.json({ error: 'No HF API key available' });
  }
  
  // Test 1: Basic sentiment model
  try {
    console.log('🧪 Testing basic sentiment model...');
    const sentiment1 = await hf.textClassification({
      model: 'cardiffnlp/twitter-roberta-base-sentiment',
      inputs: 'I love this classroom!'
    });
    results.sentiment_basic = { success: true, result: sentiment1 };
    console.log('✅ Basic sentiment model works');
  } catch (error) {
    results.sentiment_basic = { success: false, error: error.message };
    console.log('❌ Basic sentiment model failed:', error.message);
  }
  
  // Test 2: Alternative sentiment model
  try {
    console.log('🧪 Testing alternative sentiment model...');
    const sentiment2 = await hf.textClassification({
      model: 'distilbert-base-uncased-finetuned-sst-2-english',
      inputs: 'I love this classroom!'
    });
    results.sentiment_alt = { success: true, result: sentiment2 };
    console.log('✅ Alternative sentiment model works');
  } catch (error) {
    results.sentiment_alt = { success: false, error: error.message };
    console.log('❌ Alternative sentiment model failed:', error.message);
  }
  
  // Test 3: Simple text classification for categories
  try {
    console.log('🧪 Testing simple classification...');
    const classification = await hf.textClassification({
      model: 'distilbert-base-uncased-finetuned-sst-2-english',
      inputs: 'What does AI mean?'
    });
    results.classification = { success: true, result: classification };
    console.log('✅ Simple classification works');
  } catch (error) {
    results.classification = { success: false, error: error.message };
    console.log('❌ Simple classification failed:', error.message);
  }
  
  res.json({
    timestamp: new Date(),
    huggingface_connected: true,
    model_tests: results
  });
});

// Socket.io Real-time Events
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  console.log('📋 Registering socket event handlers for:', socket.id);

  socket.on('join-session', (sessionCode) => {
    socket.join(sessionCode);
    console.log(`User ${socket.id} joined session ${sessionCode}`);
  });

  socket.on('submit-question', async (data) => {
  console.log('🎯 SUBMIT-QUESTION EVENT RECEIVED!', data);
  console.log('📝 Processing question for room:', data.sessionCode);
  
  const { sessionCode, studentName, questionText, sentiment } = data;
  
  try {
    const questionId = uuidv4();
    // const category = FreeAI.categorizeQuestion(questionText);

    const category = await EnhancedAI.categorizeQuestion(questionText);
    const analyzedSentiment = await EnhancedAI.analyzeSentiment(questionText);

    console.log(`🤖 AI Results - Category: ${category}, Sentiment: ${analyzedSentiment}`);
    
    console.log(`🤖 AI categorized question as: ${category}`);
    
    // Get existing questions for this room
    db.all(
      'SELECT * FROM questions WHERE session_id = ?', 
      [sessionCode],
      (err, existingQuestions) => {
        if (err) {
          console.error('❌ Database error:', err);
          existingQuestions = [];
        }
        
        console.log(`📚 Found ${existingQuestions.length} existing questions in room ${sessionCode}`);
        
        // Find similar questions
        const similarQuestions = FreeAI.findSimilarQuestions(questionText, existingQuestions);
        console.log(`🔍 Found ${similarQuestions.length} similar questions`);
        
        // Generate topic cluster
        const relatedQuestions = existingQuestions.filter(q => 
          similarQuestions.some(s => s.questionId === q.id)
        );
        relatedQuestions.push({ question_text: questionText });
        
        const topicSummary = FreeAI.generateTopicSummary(relatedQuestions);
        const topicCluster = topicSummary ? topicSummary.title : category;
        
        console.log(`🏷️ Topic cluster: ${topicCluster}`);
        
        // Save question to database
        db.run(
          'INSERT INTO questions (id, session_id, student_name, question_text, sentiment, topic_cluster) VALUES (?, ?, ?, ?, ?, ?)',
          [questionId, sessionCode, studentName, questionText, analyzedSentiment, topicCluster],
          function(err) {
            if (err) {
              console.error('❌ Error saving question to database:', err);
              return;
            }
            
            console.log(`✅ Question saved to database with ID: ${questionId}`);
            
            const questionData = {
              id: questionId,
              sessionId: sessionCode,
              studentName,
              questionText,
              sentiment,
              category,
              topicCluster,
              similarQuestions,
              topicSummary,
              timestamp: new Date(),
              upvotes: 0
            };
            
            console.log(`📡 Broadcasting question to all users in room ${sessionCode}`);
            
            // Broadcast to all users in this room
            io.to(sessionCode).emit('new-question', questionData);
            
            console.log(`🎉 Question broadcast complete!`);
          }
        );
      }
    );
  } catch (error) {
    console.error('💥 Error processing question:', error);
  }
});

  socket.onAny((eventName, ...args) => {
    console.log(`🔍 Received event: ${eventName}`, args);
    });

  socket.on('submit-sentiment', (data) => {
    const { sessionCode, sentimentType, studentId } = data;
    
    db.get('SELECT id FROM sessions WHERE code = ?', [sessionCode], (err, session) => {
      if (err || !session) return;
      
      const sentimentId = uuidv4();
      db.run(
        'INSERT INTO sentiments (id, session_id, student_id, sentiment_type) VALUES (?, ?, ?, ?)',
        [sentimentId, session.id, studentId, sentimentType],
        function(err) {
          if (!err) {
            io.to(sessionCode).emit('sentiment-update', {
              sentimentType,
              timestamp: new Date()
            });
            console.log(`😊 Sentiment update: ${sentimentType} in session ${sessionCode}`);
          }
        }
      );
    });
  });

  socket.on('upvote-question', (data) => {
    const { questionId, sessionCode } = data;
    
    db.run('UPDATE questions SET upvotes = upvotes + 1 WHERE id = ?', [questionId], function(err) {
      if (!err) {
        io.to(sessionCode).emit('question-upvoted', { questionId, upvotes: this.changes });
        console.log(`👍 Question upvoted in session ${sessionCode}`);
      }
    });
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 5001;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📁 Database: ${dbPath}`);
  console.log(`🌐 Test URL: http://localhost:${PORT}/api/test`);
  console.log(`🤖 AI: Free NLP libraries loaded (compromise + natural)`);
  console.log(`💬 WebSocket: Real-time communication ready`);
});