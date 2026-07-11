import React, { useState, useEffect, useRef } from 'react';
import { Pen, Share2, X, Sparkles, School, Trash2, Lock } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, onSnapshot, addDoc, deleteDoc, doc, updateDoc, setDoc } from 'firebase/firestore';

// 1. Firebase 초기화 (필수 규칙 준수)
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// 쪽지 배경색 팔레트 (파스텔톤)
const COLOR_PALETTE = [
  { id: 'yellow', bg: 'bg-[#FFF9C4]', border: 'border-[#FFF59D]', text: 'text-gray-800' },
  { id: 'pink', bg: 'bg-[#F8BBD0]', border: 'border-[#F48FB1]', text: 'text-gray-900' },
  { id: 'blue', bg: 'bg-[#B3E5FC]', border: 'border-[#81D4FA]', text: 'text-gray-900' },
  { id: 'green', bg: 'bg-[#C8E6C9]', border: 'border-[#A5D6A7]', text: 'text-gray-900' },
  { id: 'purple', bg: 'bg-[#E1BEE7]', border: 'border-[#CE93D8]', text: 'text-gray-900' },
  { id: 'white', bg: 'bg-[#FFFFFF]', border: 'border-gray-200', text: 'text-gray-800' },
];

// 쪽지 회전 효과
const ROTATIONS = ['-rotate-2', 'rotate-1', '-rotate-1', 'rotate-2', 'rotate-0', '-rotate-3', 'rotate-3'];

export default function App() {
  const [user, setUser] = useState(null);
  const [messages, setMessages] = useState([]);
  
  // 전역 상태 (마감 여부 등)
  const [globalSettings, setGlobalSettings] = useState({ isFinished: false });
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [selectedMessage, setSelectedMessage] = useState(null);
  
  // 폼 상태
  const [author, setAuthor] = useState('');
  const [content, setContent] = useState('');
  const [selectedColor, setSelectedColor] = useState(COLOR_PALETTE[0]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 관리자 상태
  const [secretClickCount, setSecretClickCount] = useState(0);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);

  // 드래그 앤 드롭 상태
  const [draggedItem, setDraggedItem] = useState(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const containerRef = useRef(null);

  // 커스텀 Confirm 모달 상태
  const [confirmDialog, setConfirmDialog] = useState({ isOpen: false, type: '', targetId: null, message: '' });

  // 2. 인증 설정
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (error) {
        console.error("인증 오류:", error);
      }
    };
    initAuth();
    
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // 3. 실시간 데이터 불러오기 (메시지 + 전역 설정)
  useEffect(() => {
    if (!user) return;
    
    const messagesRef = collection(db, 'artifacts', appId, 'public', 'data', 'rolling_messages');
    const settingsRef = doc(db, 'artifacts', appId, 'public', 'data', 'settings', 'global');

    // 메시지 실시간 로드
    const unsubscribeMessages = onSnapshot(messagesRef, (snapshot) => {
      const msgs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      // 정렬 로직: 관리자가 드래그해서 저장한 zIndex가 있다면 우선 반영, 없으면 최신순
      msgs.sort((a, b) => {
        if (a.zIndex && b.zIndex) return a.zIndex - b.zIndex;
        return (a.createdAt || 0) - (b.createdAt || 0); // 옛날 글이 먼저 등록된 순으로 배치
      });
      setMessages(msgs);
    });

    // 마감 상태 등 전역 설정 실시간 로드
    const unsubscribeSettings = onSnapshot(settingsRef, (docSnap) => {
      if (docSnap.exists()) {
        setGlobalSettings(docSnap.data());
      }
    });

    return () => {
      unsubscribeMessages();
      unsubscribeSettings();
    };
  }, [user]);

  // 글 남기기 처리
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!user || !author.trim() || !content.trim() || isSubmitting || globalSettings.isFinished) return;

    setIsSubmitting(true);
    try {
      const messagesRef = collection(db, 'artifacts', appId, 'public', 'data', 'rolling_messages');
      await addDoc(messagesRef, {
        author: author.trim(),
        content: content.trim(),
        colorId: selectedColor.id,
        createdAt: Date.now(),
        position: null, // 초기 위치는 null (기본 그리드 배치)
        zIndex: Date.now() // 생성 순서를 zIndex 기본값으로
      });
      
      setAuthor('');
      setContent('');
      setSelectedColor(COLOR_PALETTE[0]);
      setIsModalOpen(false);
      showToast('태린이에게 메시지를 성공적으로 남겼어요! 💌');
    } catch (error) {
      console.error("메시지 저장 오류:", error);
      showToast('메시지 저장에 실패했습니다. 다시 시도해주세요.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ----- 관리자 기능 로직 -----

  // 1. 비밀 탭 처리 (3번 연속 클릭 시 관리자 모달 팝업)
  const handleSecretClick = () => {
    if (globalSettings.isFinished) return; // 이미 마감되었으면 진입 불가
    
    const newCount = secretClickCount + 1;
    setSecretClickCount(newCount);
    
    if (newCount >= 3) {
      setIsPasswordModalOpen(true);
      setSecretClickCount(0); // 3번 넘으면 초기화
    }
    
    // 1초 뒤에 연속 클릭 카운트 초기화 (빠르게 3번 눌러야 함)
    setTimeout(() => {
      setSecretClickCount(0);
    }, 1000);
  };

  // 2. 비밀번호 확인
  const handlePasswordSubmit = (e) => {
    e.preventDefault();
    if (passwordInput === '3495') {
      setIsAdmin(true);
      setIsPasswordModalOpen(false);
      showToast('관리자 모드가 활성화되었습니다. (드래그 이동 & 삭제 가능)');
    } else {
      showToast('비밀번호가 틀렸습니다.');
    }
    setPasswordInput('');
  };

  // 3. 메시지 삭제
  const handleDeleteMessage = (e, id) => {
    e.preventDefault();
    e.stopPropagation(); // 모달 팝업 및 드래그 방지
    if (!isAdmin) return;
    
    setConfirmDialog({ 
      isOpen: true, 
      type: 'DELETE', 
      targetId: id, 
      message: '정말 이 메시지를 삭제하시겠습니까?' 
    });
  };

  // 4. 드래그 앤 드롭 로직 (관리자일 때만 동작)
  const handlePointerDown = (e, msg) => {
    if (!isAdmin) return;
    
    // 삭제 버튼 클릭 시 드래그 방지
    if (e.target.closest('button')) return;

    // 터치와 마우스 이벤트 호환
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const containerRect = containerRef.current.getBoundingClientRect();

    // 현재 저장된 절대 위치가 있는지 확인 (없으면 현재 그리드 상의 위치를 가져옴)
    let currentX = msg.position?.x;
    let currentY = msg.position?.y;

    if (!msg.position) {
      // 처음 드래그 하는 요소는 현재 화면상의 위치를 절대 위치로 변환
      currentX = rect.left - containerRect.left;
      currentY = rect.top - containerRect.top;
    }

    setDraggedItem(msg);
    setDragOffset({
      x: clientX - currentX,
      y: clientY - currentY
    });

    // 드래그 시작 시 선택된 요소를 가장 위로
    el.style.zIndex = 9999;
  };

  const handlePointerMove = (e) => {
    if (!isAdmin || !draggedItem) return;
    e.preventDefault(); // 드래그 중 화면 스크롤 방지

    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    const newX = clientX - dragOffset.x;
    const newY = clientY - dragOffset.y;

    // 상태(State) 업데이트 대신 DOM 직접 조작으로 부드러운 이동 처리
    const el = document.getElementById(`msg-${draggedItem.id}`);
    if (el) {
      el.style.position = 'absolute';
      el.style.left = `${newX}px`;
      el.style.top = `${newY}px`;
    }
  };

  const handlePointerUp = async (e) => {
    if (!isAdmin || !draggedItem) return;

    const el = document.getElementById(`msg-${draggedItem.id}`);
    if (!el) return;

    const newLeft = parseFloat(el.style.left);
    const newTop = parseFloat(el.style.top);

    // 드래그 끝난 최종 위치를 Firestore에 저장
    try {
      await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'rolling_messages', draggedItem.id), {
        position: { x: newLeft, y: newTop },
        zIndex: Date.now() // 맨 위로 갱신
      });
    } catch (error) {
      console.error("위치 저장 실패:", error);
    }

    setDraggedItem(null);
  };

  // 5. 롤링페이퍼 최종 마감 처리 (이후부터는 쓰기 방지 & 관리자 모드 영구 비활성화)
  const handleFinish = () => {
    setConfirmDialog({ 
      isOpen: true, 
      type: 'FINISH', 
      targetId: null, 
      message: '정말 마감하시겠습니까?\n마감 후에는 더 이상 글을 남기거나 위치를 수정할 수 없으며, 온전한 롤링페이퍼만 남게 됩니다.' 
    });
  };

  // 6. 커스텀 액션 실행 (삭제 & 마감)
  const handleConfirmAction = async () => {
    if (confirmDialog.type === 'DELETE') {
      try {
        await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'rolling_messages', confirmDialog.targetId));
        showToast('메시지가 삭제되었습니다.');
      } catch (error) {
        console.error("삭제 실패:", error);
        showToast('삭제 실패');
      }
    } else if (confirmDialog.type === 'FINISH') {
      try {
        // 전역 설정 문서 업데이트
        const settingsRef = doc(db, 'artifacts', appId, 'public', 'data', 'settings', 'global');
        await setDoc(settingsRef, { isFinished: true });
        
        setIsAdmin(false); // 마감 즉시 관리자 모드 해제
        showToast('롤링페이퍼가 최종 마감되었습니다! ✨');
      } catch (error) {
        showToast('마감 처리 실패');
      }
    }
    setConfirmDialog({ isOpen: false, type: '', targetId: null, message: '' });
  };

  // 링크 공유 기능
  const handleShare = () => {
    const url = window.location.href;
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(url).then(() => {
        showToast('링크가 복사되었습니다! 단톡방에 공유해보세요. ✨');
      }).catch(() => fallbackCopyTextToClipboard(url));
    } else {
      fallbackCopyTextToClipboard(url);
    }
  };

  const fallbackCopyTextToClipboard = (text) => {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed"; 
    textArea.style.opacity = "0";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      document.execCommand('copy');
      showToast('링크가 복사되었습니다! 단톡방에 공유해보세요. ✨');
    } catch (err) {
      showToast('주소창의 링크를 복사해주세요.');
    }
    document.body.removeChild(textArea);
  };

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 3000);
  };

  const combinedStyle = {
    fontFamily: "'Gowun Dodum', sans-serif",
    userSelect: draggedItem ? 'none' : 'auto'
  };

  return (
    <div 
      className="min-h-screen bg-[#FDFBF7] relative overflow-x-hidden flex flex-col" 
      style={combinedStyle}
      // 전체 영역에 드래그 이벤트 부착 (빠르게 마우스 움직여도 놓치지 않게)
      onMouseMove={handlePointerMove}
      onMouseUp={handlePointerUp}
      onTouchMove={handlePointerMove}
      onTouchEnd={handlePointerUp}
    >
      <style>
        {`
          @import url('https://fonts.googleapis.com/css2?family=Gowun+Dodum&display=swap');
          @import url('https://fonts.googleapis.com/css2?family=Gowun+Batang:wght@700&display=swap');
          .title-font { font-family: 'Gowun Batang', serif; }
          ::-webkit-scrollbar { width: 6px; }
          ::-webkit-scrollbar-track { background: transparent; }
          ::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 4px; }
          .glass-panel {
            background: rgba(255, 255, 255, 0.75);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            border-bottom: 1px solid rgba(255, 255, 255, 0.6);
          }
        `}
      </style>

      {/* 배경 감성 데코레이션 */}
      <div className="fixed top-0 left-0 w-full h-full pointer-events-none overflow-hidden z-0">
        <div className="absolute top-[5%] left-[5%] w-32 h-32 md:w-48 md:h-48 bg-pink-200/50 rounded-full mix-blend-multiply blur-3xl animate-pulse"></div>
        <div className="absolute top-[20%] right-[10%] w-40 h-40 md:w-56 md:h-56 bg-yellow-200/50 rounded-full mix-blend-multiply blur-3xl animate-pulse" style={{ animationDelay: '2s' }}></div>
        <div className="absolute bottom-[-5%] left-[30%] w-48 h-48 md:w-64 md:h-64 bg-blue-200/40 rounded-full mix-blend-multiply blur-3xl"></div>
      </div>

      {/* 헤더 영역 */}
      <header className="sticky top-0 z-20 glass-panel py-3 px-4 shadow-sm flex items-center justify-between">
        <div className="flex flex-col">
          <div className="flex items-center space-x-1 text-[11px] sm:text-xs text-gray-500 mb-0.5">
            <School className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
            <span>인천상정중학교 3학년 1반</span>
          </div>
          <div className="flex items-center space-x-1.5 sm:space-x-2">
            <Sparkles className="w-4 h-4 sm:w-5 sm:h-5 text-yellow-500 fill-yellow-500" />
            <h1 className="title-font text-base sm:text-lg md:text-2xl font-bold text-gray-800 tracking-tight">
              태린아, 넌 어딜 가든 빛날 거야 ✨
            </h1>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          {/* 관리자 모드일 때만 보이는 빨간색 마감 버튼 */}
          {isAdmin && (
            <button 
              onClick={handleFinish}
              className="flex items-center bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 px-3 py-2 rounded-full text-xs sm:text-sm font-bold transition-colors shadow-sm shrink-0"
            >
              <Lock className="w-3.5 h-3.5 mr-1" />
              최종 마감하기
            </button>
          )}
          <button 
            onClick={handleShare}
            className="flex items-center justify-center bg-white border border-gray-200 hover:bg-gray-50 active:bg-gray-100 text-gray-700 w-9 h-9 sm:w-auto sm:px-3 sm:py-2 rounded-full sm:text-sm font-medium transition-colors shadow-sm shrink-0"
            aria-label="공유하기"
          >
            <Share2 className="w-4 h-4" />
            <span className="hidden sm:inline sm:ml-1.5">단톡방 공유</span>
          </button>
        </div>
      </header>

      {/* 메인 롤링페이퍼 보드 */}
      <main 
        className="flex-1 p-4 sm:p-6 md:p-8 z-10 w-full max-w-6xl mx-auto flex flex-col relative min-h-[80vh]"
        ref={containerRef}
      >
        <div className="text-center mb-8 mt-2 sm:mt-4">
          <h2 className="text-gray-700 text-sm sm:text-base md:text-lg font-medium leading-relaxed">
            그동안 우리가 함께했던 <span className="text-pink-500 font-bold bg-pink-50/80 px-1.5 py-0.5 rounded">추억</span>을 기억해줘.
          </h2>
          <div className="inline-flex items-center justify-center mt-3 bg-white/70 backdrop-blur-sm px-4 py-1.5 rounded-full border border-gray-200/50 shadow-sm">
            <span className="text-gray-500 text-xs sm:text-sm font-medium">
              3학년 1반 친구들의 마음 <strong className="text-pink-500 mx-0.5">{messages.length}</strong>개가 모였어요.
            </span>
          </div>
        </div>

        {messages.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-400 space-y-4">
            <Sparkles className="w-10 h-10 sm:w-12 sm:h-12 text-yellow-300 animate-bounce" />
            <p className="text-sm sm:text-base text-center leading-relaxed">
              아직 작성된 메시지가 없어요.<br/>
              가장 먼저 태린이에게 인사를 건네보세요!
            </p>
          </div>
        ) : (
          <div className="relative w-full h-full pb-28">
            {/* 그리드 컨테이너 대신 Flex 컨테이너로 변경하여 쪽지 크기를 고정시킵니다 */}
            <div className="flex flex-wrap gap-3 sm:gap-4 md:gap-6 w-full justify-center sm:justify-start">
              {messages.map((msg, index) => {
                const colorInfo = COLOR_PALETTE.find(c => c.id === msg.colorId) || COLOR_PALETTE[0];
                const rotationClass = ROTATIONS[index % ROTATIONS.length];
                
                // 관리자가 위치를 이동시켜 absolute position 값을 가진 메시지인지 확인
                const isAbsolute = msg.position !== null && msg.position !== undefined;
                
                const style = isAbsolute ? {
                  position: 'absolute',
                  left: `${msg.position.x}px`,
                  top: `${msg.position.y}px`,
                  zIndex: msg.zIndex || 1,
                  touchAction: isAdmin ? 'none' : 'auto' // 모바일 드래그 시 스크롤 방지
                } : {
                  position: 'relative', // 기본 배치
                  zIndex: msg.zIndex || 1,
                  touchAction: isAdmin ? 'none' : 'auto'
                };

                return (
                  <div 
                    id={`msg-${msg.id}`}
                    key={msg.id}
                    style={style}
                    onMouseDown={(e) => handlePointerDown(e, msg)}
                    onTouchStart={(e) => handlePointerDown(e, msg)}
                    // 일반 사용자일 때만 터치해서 확대 모달 띄움 (관리자는 드래그 위주)
                    onClick={() => {
                      if (!isAdmin && !draggedItem) setSelectedMessage(msg);
                    }}
                    className={`
                      ${colorInfo.bg} ${colorInfo.border} ${colorInfo.text} 
                      ${!isAdmin && rotationClass} /* 관리자 모드일땐 회전 풀기 (드래그 편하게) */
                      border p-3 sm:p-4 rounded-xl shadow-sm shrink-0
                      flex flex-col 
                      w-[44vw] h-[140px] sm:w-[170px] sm:h-[160px] md:w-[190px] md:h-[180px] /* 드래그 중에도 크기가 변하지 않도록 완벽히 고정 */
                      ${isAdmin ? 'cursor-move hover:ring-2 hover:ring-blue-400' : 'cursor-pointer transition-all duration-300 hover:shadow-md hover:scale-105 hover:z-10'}
                      group
                    `}
                  >
                    {/* 상단 테이프 디자인 */}
                    <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 w-10 sm:w-12 h-5 bg-white/40 backdrop-blur-sm shadow-sm rotate-2 rounded-sm transition-transform group-hover:rotate-0"></div>
                    
                    {/* 관리자 모드일 때 보여지는 삭제 버튼 (터치 이벤트 최적화 및 타겟 확장) */}
                    {isAdmin && (
                      <button
                        onMouseDown={(e) => handleDeleteMessage(e, msg.id)}
                        onTouchStart={(e) => handleDeleteMessage(e, msg.id)}
                        className="absolute -top-3 -right-3 bg-red-500 text-white rounded-full p-2 shadow-xl hover:bg-red-600 z-50"
                        aria-label="삭제"
                      >
                        <Trash2 className="w-4 h-4 pointer-events-none" />
                      </button>
                    )}

                    {/* 메시지 내용 */}
                    <div className="flex-1 whitespace-pre-wrap leading-snug sm:leading-relaxed mt-2 text-[13px] sm:text-[15px] break-words overflow-hidden pointer-events-none" style={{ display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical' }}>
                      {msg.content}
                    </div>
                    
                    {/* 작성자 & 날짜 */}
                    <div className="mt-2 pt-2 border-t border-black/5 flex justify-between items-end shrink-0 pointer-events-none">
                      <span className="font-bold text-xs sm:text-sm truncate pr-2 max-w-[70%]">
                        {msg.author}
                      </span>
                      <span className="text-[9px] sm:text-[10px] opacity-60 whitespace-nowrap">
                        {new Date(msg.createdAt).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>

      {/* 하단 버튼 영역 (글쓰기 & 비밀 관리자 버튼) - 마감되면 렌더링 안함 */}
      {!globalSettings.isFinished && (
        <div className="fixed bottom-6 right-4 sm:bottom-8 sm:right-8 flex items-center z-20">
          
          {/* 비밀 관리자 모드 진입 버튼 (글쓰기 버튼 바로 왼쪽의 투명한 빈 공간) */}
          <div 
            onClick={handleSecretClick}
            className="w-12 h-14 mr-2 bg-transparent cursor-default" // 화면에 안보임
            aria-label="Secret Admin Touch Area"
          />

          {/* 일반 사용자 글 남기기 플로팅 버튼 */}
          <button
            onClick={() => setIsModalOpen(true)}
            className="px-5 sm:px-6 h-12 sm:h-14 bg-gray-800 text-white rounded-full flex items-center justify-center space-x-2 shadow-xl hover:bg-gray-700 active:scale-95 transition-all"
            aria-label="글 남기기"
          >
            <Pen className="w-4 h-4 sm:w-5 sm:h-5" />
            <span className="font-medium text-sm sm:text-base">글 남기기</span>
          </button>

        </div>
      )}

      {/* --- 각종 모달 창 --- */}

      {/* 0-1. 커스텀 확인(Confirm) 모달 (삭제 및 마감 시 사용) */}
      {confirmDialog.isOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white p-6 rounded-2xl shadow-2xl max-w-sm w-full relative animate-in zoom-in-95 duration-200">
            <h3 className="font-bold text-lg mb-2 text-gray-800">
              {confirmDialog.type === 'DELETE' ? '메시지 삭제' : '최종 마감 확인'}
            </h3>
            <p className="text-sm text-gray-500 mb-6 whitespace-pre-wrap leading-relaxed">
              {confirmDialog.message}
            </p>
            <div className="flex space-x-3">
              <button 
                onClick={() => setConfirmDialog({ isOpen: false, type: '', targetId: null, message: '' })} 
                className="flex-1 bg-gray-100 text-gray-700 py-3 rounded-xl font-bold hover:bg-gray-200 transition-colors"
              >
                취소
              </button>
              <button 
                onClick={handleConfirmAction} 
                className="flex-1 bg-red-500 text-white py-3 rounded-xl font-bold hover:bg-red-600 transition-colors shadow-sm"
              >
                {confirmDialog.type === 'DELETE' ? '삭제하기' : '마감하기'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 0. 비밀번호 입력 모달 */}
      {isPasswordModalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white p-6 rounded-2xl shadow-2xl max-w-sm w-full relative">
            <button onClick={() => setIsPasswordModalOpen(false)} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600">
              <X className="w-5 h-5" />
            </button>
            <h3 className="font-bold text-lg mb-4 text-gray-800">관리자 모드 활성화</h3>
            <p className="text-sm text-gray-500 mb-4">비밀번호를 입력하여 롤링페이퍼 정리를 시작하세요.</p>
            <form onSubmit={handlePasswordSubmit}>
              <input
                type="password"
                placeholder="비밀번호 4자리"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                className="w-full border border-gray-300 p-3 rounded-xl mb-4 focus:outline-none focus:ring-2 focus:ring-pink-400"
                autoFocus
              />
              <button type="submit" className="w-full bg-gray-800 text-white py-3 rounded-xl font-bold hover:bg-gray-900 transition-colors">
                확인
              </button>
            </form>
          </div>
        </div>
      )}

      {/* 1. 메시지 확대 보기 모달 (일반 사용자 전용) */}
      {selectedMessage && !isAdmin && (
        <div 
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 sm:p-6 transition-opacity"
          onClick={() => setSelectedMessage(null)} 
        >
          <div 
            className={`
              ${COLOR_PALETTE.find(c => c.id === selectedMessage.colorId)?.bg || COLOR_PALETTE[0].bg}
              ${COLOR_PALETTE.find(c => c.id === selectedMessage.colorId)?.border || COLOR_PALETTE[0].border}
              ${COLOR_PALETTE.find(c => c.id === selectedMessage.colorId)?.text || COLOR_PALETTE[0].text}
              border-2 w-full max-w-sm sm:max-w-md rounded-2xl shadow-2xl p-6 sm:p-8 flex flex-col relative
              animate-in zoom-in-95 duration-200
            `}
            onClick={(e) => e.stopPropagation()} 
          >
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 w-16 h-6 bg-white/50 backdrop-blur-md shadow-sm rotate-1 rounded-sm"></div>
            <button onClick={() => setSelectedMessage(null)} className="absolute top-3 right-3 p-1.5 bg-black/5 hover:bg-black/10 rounded-full transition-colors">
              <X className="w-5 h-5 opacity-70" />
            </button>
            <div className="mt-4 whitespace-pre-wrap leading-relaxed text-base sm:text-lg min-h-[150px] max-h-[60vh] overflow-y-auto break-words">
              {selectedMessage.content}
            </div>
            <div className="mt-8 pt-4 border-t border-black/10 flex justify-between items-end shrink-0">
              <span className="font-bold text-base sm:text-lg">From. {selectedMessage.author}</span>
              <span className="text-xs sm:text-sm opacity-60">
                {new Date(selectedMessage.createdAt).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* 2. 글 작성 모달 (바텀 시트) - 마감되면 아예 안 뜸 */}
      {isModalOpen && !globalSettings.isFinished && (
        <div 
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm transition-opacity p-0 sm:p-4"
          onClick={() => setIsModalOpen(false)}
        >
          <div 
            className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-full sm:slide-in-from-bottom-4 sm:zoom-in-95 duration-300"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sm:hidden w-12 h-1.5 bg-gray-200 rounded-full mx-auto mt-4 mb-2"></div>
            <div className="flex justify-between items-center px-6 py-4 sm:p-6 border-b border-gray-100">
              <h3 className="text-lg sm:text-xl font-bold text-gray-800 title-font">태린이에게 마음 전하기 ✍️</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-600 active:bg-gray-100 p-1.5 rounded-full transition-colors">
                <X className="w-5 h-5 sm:w-6 sm:h-6" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="px-6 py-5 sm:p-6 flex flex-col space-y-5 max-h-[80vh] overflow-y-auto">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">누가 보내는 건가요?</label>
                <input
                  type="text" required maxLength={20} placeholder="내 이름 또는 별명"
                  value={author} onChange={(e) => setAuthor(e.target.value)}
                  className="w-full px-4 py-3 sm:py-3.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-pink-400 focus:border-transparent transition-all bg-gray-50 text-base"
                />
              </div>
              <div>
                <div className="flex justify-between items-end mb-1.5">
                  <label className="block text-sm font-medium text-gray-700">어떤 말을 전하고 싶나요?</label>
                  <span className={`text-xs ${content.length >= 300 ? 'text-red-500 font-bold' : 'text-gray-400'}`}>
                    {content.length}/300자
                  </span>
                </div>
                <textarea
                  required maxLength={300} rows={4} placeholder="함께했던 즐거운 추억이나 응원의 말을 적어주세요!"
                  value={content} onChange={(e) => setContent(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-pink-400 focus:border-transparent transition-all resize-none bg-gray-50 text-base leading-relaxed"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2.5">쪽지 색상을 골라주세요</label>
                <div className="flex flex-wrap gap-3 sm:gap-4">
                  {COLOR_PALETTE.map((color) => (
                    <button
                      key={color.id} type="button" onClick={() => setSelectedColor(color)}
                      className={`w-10 h-10 sm:w-11 sm:h-11 rounded-full border-2 transition-transform duration-200 ${color.bg} ${color.border} ${selectedColor.id === color.id ? 'scale-110 ring-2 ring-offset-2 ring-gray-400 shadow-md' : 'hover:scale-105'}`}
                    />
                  ))}
                </div>
              </div>
              <div className="pt-4 pb-6 sm:pb-0">
                <button
                  type="submit" disabled={isSubmitting || !author.trim() || !content.trim()}
                  className={`w-full py-4 sm:py-3.5 rounded-xl text-white font-bold text-base sm:text-lg transition-all ${(isSubmitting || !author.trim() || !content.trim()) ? 'bg-gray-300 cursor-not-allowed' : 'bg-gray-800 hover:bg-gray-900 active:scale-[0.98] shadow-md'}`}
                >
                  {isSubmitting ? '남기는 중...' : '롤링페이퍼에 붙이기'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 토스트 알림 */}
      {toastMessage && (
        <div className="fixed top-16 sm:top-auto sm:bottom-24 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-top-5 sm:slide-in-from-bottom-5 fade-in duration-300 w-[90%] max-w-sm flex justify-center pointer-events-none">
          <div className="bg-gray-800/95 backdrop-blur text-white px-5 py-3.5 rounded-2xl shadow-xl flex items-center justify-center text-center text-sm sm:text-base font-medium w-full">
            {toastMessage}
          </div>
        </div>
      )}
    </div>
  );
}
