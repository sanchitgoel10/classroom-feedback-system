import { io } from 'socket.io-client';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001';

class SocketService {
  constructor() {
    this.socket = null;
  }

  connect() {
    if (!this.socket) {
      console.log(`🔌 Connecting to backend at: ${API_URL}`);
      this.socket = io(API_URL);
      
      // Add connection event listeners for debugging
      this.socket.on('connect', () => {
        console.log('✅ Socket connected with ID:', this.socket.id);
      });
      
      this.socket.on('disconnect', () => {
        console.log('❌ Socket disconnected');
      });
      
      this.socket.on('connect_error', (error) => {
        console.error('🚫 Socket connection error:', error);
      });
    }
    return this.socket;
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  joinSession(sessionCode) {
    if (this.socket) {
      console.log(`🏠 Joining session: ${sessionCode}`);
      this.socket.emit('join-session', sessionCode);
    } else {
      console.error('❌ Cannot join session - socket not connected');
    }
  }

  submitQuestion(data) {
    if (this.socket) {
      console.log('📤 Emitting submit-question event with data:', data);
      this.socket.emit('submit-question', data);
      console.log('✅ submit-question event emitted successfully');
    } else {
      console.error('❌ Cannot submit question - socket not connected');
    }
  }

  submitSentiment(data) {
    if (this.socket) {
      console.log('😊 Emitting sentiment:', data);
      this.socket.emit('submit-sentiment', data);
    }
  }

  upvoteQuestion(data) {
    if (this.socket) {
      console.log('👍 Emitting upvote:', data);
      this.socket.emit('upvote-question', data);
    }
  }

  onNewQuestion(callback) {
    if (this.socket) {
      console.log('🎧 Setting up new-question listener');
      this.socket.on('new-question', (data) => {
        console.log('📨 Received new-question event:', data);
        callback(data);
      });
    }
  }

  onSentimentUpdate(callback) {
    if (this.socket) {
      this.socket.on('sentiment-update', callback);
    }
  }

  onQuestionUpvoted(callback) {
    if (this.socket) {
      this.socket.on('question-upvoted', callback);
    }
  }

  off(event) {
    if (this.socket) {
      this.socket.off(event);
    }
  }

  clearSession(roomId) {
  if (this.socket) {
    console.log('🔄 Broadcasting session clear');
    // This is handled by the backend API call, not direct socket emission
    }
  }
}

const socketService = new SocketService();
export default socketService;