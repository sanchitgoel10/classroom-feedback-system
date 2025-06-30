import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import socketService from './services/socket';

const Home = () => (
  <div>
    <h1>Classroom Feedback System</h1>
    <p><a href="/room/101">Go to Room 101 (Student Interface)</a></p>
    <p><a href="/teacher/101">Go to Teacher Dashboard</a></p>
  </div>
);

const Room = () => {
  const roomId = window.location.pathname.split('/')[2];
  const [studentName, setStudentName] = useState('');
  const [question, setQuestion] = useState('');
  const [myQuestions, setMyQuestions] = useState([]); // Only student's own questions
  const [isConnected, setIsConnected] = useState(false);

  const loadMyQuestions = async () => {
    // Students start fresh - no need to load previous questions
    console.log('Student interface loaded - starting fresh');
  };

  useEffect(() => {
    const socket = socketService.connect();
    
    socket.on('connect', () => {
      setIsConnected(true);
      socketService.joinSession(roomId);
      console.log(`✅ Student connected to room ${roomId}`);
      loadMyQuestions();
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
      console.log(`❌ Student disconnected from room ${roomId}`);
    });

    // Listen for session clear events
    socket.on('session-cleared', (data) => {
      console.log('🔄 Session cleared by teacher:', data);
      setMyQuestions([]); // Clear student's questions too
      alert(`Session cleared! Starting fresh for: ${data.courseName}`);
    });

    return () => {
      socket.off('session-cleared');
    };
  }, [roomId]);

  const submitQuestion = (e) => {
    e.preventDefault();
    if (!question.trim() || !studentName.trim()) {
      alert('Please enter both name and question');
      return;
    }

    const questionData = {
      sessionCode: roomId,
      studentName,
      questionText: question,
      sentiment: 'neutral',
      timestamp: new Date()
    };

    console.log('📤 Submitting question:', questionData);
    
    // Add to student's own questions immediately (checkpoint)
    setMyQuestions(prev => [...prev, {
      ...questionData,
      status: 'submitted',
      id: Date.now()
    }]);

    socketService.submitQuestion(questionData);
    setQuestion('');
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial' }}>
      <h1>Room {roomId} - Student Interface</h1>
      <p>Status: {isConnected ? '🟢 Connected' : '🔴 Disconnected'}</p>
      
      <form onSubmit={submitQuestion} style={{ border: '2px solid #ccc', padding: '15px', marginBottom: '20px' }}>
        <h3>Submit Your Question</h3>
        <div>
          <input 
            placeholder="Your name" 
            value={studentName}
            onChange={(e) => setStudentName(e.target.value)}
            style={{ marginBottom: '10px', padding: '8px', width: '200px', fontSize: '14px' }}
          />
        </div>
        <div>
          <textarea 
            placeholder="Your question (e.g., What does ROI mean?)"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            style={{ marginBottom: '10px', padding: '8px', width: '400px', height: '80px', fontSize: '14px' }}
          />
        </div>
        <button type="submit" style={{ padding: '10px 20px', fontSize: '16px', backgroundColor: '#007cba', color: 'white', border: 'none', cursor: 'pointer' }}>
          Submit Question
        </button>
      </form>

      {/* Student's Own Questions (Checkpoint) */}
      <div style={{ border: '2px solid #28a745', padding: '15px', marginBottom: '20px', backgroundColor: '#f8f9fa' }}>
        <h3>✅ Your Submitted Questions ({myQuestions.length}):</h3>
        {myQuestions.length === 0 ? (
          <p><em>No questions submitted yet</em></p>
        ) : (
          myQuestions.map((q, index) => (
            <div key={q.id || index} style={{ border: '1px solid #28a745', margin: '5px 0', padding: '10px', backgroundColor: 'white' }}>
              <strong>Question #{index + 1}:</strong> {q.questionText}
              <br />
              <small style={{ color: '#28a745' }}>
                ✅ Status: {q.status} at {q.timestamp.toLocaleTimeString()}
              </small>
            </div>
          ))
        )}
      </div>
      
      {/* Information for Students */}
      <div style={{ border: '2px solid #17a2b8', padding: '15px', backgroundColor: '#f8f9fa' }}>
        <h4>💡 How it works:</h4>
        <ul style={{ margin: '10px 0', paddingLeft: '20px' }}>
          <li>Your questions are sent anonymously to the teacher</li>
          <li>Teacher can see all questions organized by topic</li>
          <li>You only see your own submitted questions here</li>
          <li>Ask anything - it helps everyone learn!</li>
          <li>Similar questions are automatically grouped together</li>
        </ul>
      </div>
    </div>
  );
};

const Teacher = () => {
  const roomId = window.location.pathname.split('/')[2];
  const [questions, setQuestions] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const [courseName, setCourseName] = useState('');

  const loadExistingQuestions = async () => {
    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/api/debug/questions/${roomId}`);
      const data = await response.json();
      console.log(`📊 Teacher loaded ${data.totalQuestions} existing questions for room ${roomId}`);
      setQuestions(data.questions || []);
    } catch (error) {
      console.error('Error loading existing questions:', error);
    }
  };

  useEffect(() => {
    const socket = socketService.connect();
    
    socket.on('connect', () => {
      setIsConnected(true);
      socketService.joinSession(roomId);
      console.log(`✅ Teacher connected to room ${roomId}`);
      
      // Load existing questions when connected
      loadExistingQuestions();
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
      console.log(`❌ Teacher disconnected from room ${roomId}`);
    });

    socketService.onNewQuestion((questionData) => {
      console.log('🔔 Teacher received new question:', questionData);
      setQuestions(prev => [...prev, questionData]);
    });

    return () => {
      socketService.off('new-question');
    };
  }, [roomId]);

  const startNewSession = async () => {
    try {
      // Clear questions locally for teacher
      setQuestions([]);
      
      // Tell backend to clear this room's session
      const response = await fetch(`${import.meta.env.VITE_API_URL}/api/clear-session/${roomId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseName: courseName || `Room ${roomId}` })
      });
      
      if (response.ok) {
        const result = await response.json();
        console.log(`🔄 New session started for ${courseName || 'Room ' + roomId}`);
        alert(`New session started for ${courseName || 'Room ' + roomId}!\nCleared ${result.questionsRemoved} questions.`);
      } else {
        throw new Error('Failed to clear session');
      }
    } catch (error) {
      console.error('Error starting new session:', error);
      alert('Error starting new session. Please try again.');
    }
  };

  // Group questions by category
  const groupedQuestions = questions.reduce((groups, question) => {
    const category = question.category || 'general';
    if (!groups[category]) groups[category] = [];
    groups[category].push(question);
    return groups;
  }, {});

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial' }}>
      <h1>Teacher Dashboard - Room {roomId}</h1>
      <p>Status: {isConnected ? '🟢 Connected' : '🔴 Disconnected'}</p>
      
      <div style={{ marginBottom: '20px', border: '2px solid #007cba', padding: '15px' }}>
        <h3>Session Control</h3>
        <input 
          placeholder="Course name (e.g., Physics 101)"
          value={courseName}
          onChange={(e) => setCourseName(e.target.value)}
          style={{ marginRight: '10px', padding: '8px', width: '200px' }}
        />
        <button onClick={startNewSession} style={{ padding: '8px 15px', backgroundColor: '#dc3545', color: 'white', border: 'none', cursor: 'pointer' }}>
          🔄 Start New Session
        </button>
        {questions.length > 0 && (
          <p style={{ margin: '10px 0', color: '#666' }}>
            <strong>Current session:</strong> {questions.length} questions received
          </p>
        )}
      </div>
      
      <div style={{ border: '2px solid #28a745', padding: '15px' }}>
        <h3>📊 Live Questions ({questions.length} total):</h3>
        
        {Object.keys(groupedQuestions).length === 0 ? (
          <div style={{ backgroundColor: '#fff3cd', padding: '15px', border: '1px solid #ffeaa7' }}>
            <p><strong>No questions yet.</strong></p>
            <p>Students can submit questions at: <strong>localhost:5173/room/{roomId}</strong></p>
            <p>💡 Share this link with your students to get started!</p>
            <div style={{ marginTop: '10px', padding: '10px', backgroundColor: '#e7f3ff', border: '1px solid #b3d9ff' }}>
              <strong>Quick Start:</strong>
              <ol style={{ margin: '5px 0', paddingLeft: '20px' }}>
                <li>Share the student link with your class</li>
                <li>Students submit questions anonymously</li>
                <li>Questions appear here in real-time, organized by topic</li>
                <li>Use "Start New Session" to reset between classes</li>
              </ol>
            </div>
          </div>
        ) : (
          Object.entries(groupedQuestions)
            .sort(([,a], [,b]) => b.length - a.length) // Sort by question count
            .map(([category, categoryQuestions]) => (
            <div key={category} style={{ border: '2px solid #000', margin: '15px 0', padding: '15px', backgroundColor: '#f8f9fa' }}>
              <h4 style={{ backgroundColor: '#007cba', color: 'white', padding: '10px', margin: '-15px -15px 15px -15px' }}>
                📁 {category.toUpperCase()} ({categoryQuestions.length} questions)
              </h4>
              {categoryQuestions
                .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)) // Sort by newest first
                .map((q, index) => (
                <div key={q.id || index} style={{ border: '1px solid #ccc', margin: '10px 0', padding: '15px', backgroundColor: 'white' }}>
                  <strong style={{ fontSize: '16px' }}>{q.student_name || q.studentName}:</strong>
                  <p style={{ fontSize: '14px', margin: '5px 0' }}>{q.question_text || q.questionText}</p>
                  <small style={{ color: '#6c757d' }}>
                    Sentiment: {q.sentiment} | 
                    Time: {new Date(q.timestamp).toLocaleTimeString()}
                    {q.topicSummary && ` | Priority: ${q.topicSummary.urgency}`}
                    {q.similarQuestions?.length > 0 && ` | Similar to ${q.similarQuestions.length} other questions`}
                  </small>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
      
      {/* Teacher Analytics */}
      {questions.length > 0 && (
        <div style={{ marginTop: '20px', border: '2px solid #6c757d', padding: '15px', backgroundColor: '#f8f9fa' }}>
          <h3>📈 Session Analytics</h3>
          <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
            <div>
              <strong>Total Questions:</strong> {questions.length}
            </div>
            <div>
              <strong>Categories:</strong> {Object.keys(groupedQuestions).length}
            </div>
            <div>
              <strong>Students Participated:</strong> {new Set(questions.map(q => q.student_name || q.studentName)).size}
            </div>
            <div>
              <strong>Most Common Category:</strong> {
                Object.entries(groupedQuestions).length > 0 
                  ? Object.entries(groupedQuestions).sort(([,a], [,b]) => b.length - a.length)[0][0]
                  : 'None'
              }
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/room/:roomId" element={<Room />} />
        <Route path="/teacher/:roomId" element={<Teacher />} />
      </Routes>
    </Router>
  );
}

export default App;