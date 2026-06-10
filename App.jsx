import React, { useState, useEffect, useRef } from 'react';
import { 
  Camera, Upload, User, Activity, Flame, Droplets, Bone, 
  TrendingDown, TrendingUp, Settings, Calendar, Check, Edit2, AlertCircle, LineChart,
  LogOut, Mail, Lock
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, 
  signOut, onAuthStateChanged 
} from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, collection, onSnapshot } from 'firebase/firestore';

// --- Firebase 初始化 ---
// 注意：請在這裡填入您自己的 Firebase 設定
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {
  // apiKey: "YOUR_API_KEY",
  // authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  // projectId: "YOUR_PROJECT_ID",
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'weight-master-web';

// --- Gemini API (AI 視覺辨識) ---
// 注意：請在此處填入您的 Gemini API Key
const apiKey = ""; 

const callGeminiAPI = async (prompt, imageBase64 = null, retries = 3) => {
  if (!apiKey) {
    console.warn("未設定 API Key，回傳模擬數據");
    return null;
  }

  const model = "gemini-2.5-flash-preview-09-2025";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  let contents = [{ role: "user", parts: [{ text: prompt }] }];
  
  if (imageBase64) {
    const base64Data = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
    contents[0].parts.push({
      inlineData: { mimeType: "image/jpeg", data: base64Data }
    });
  }

  const payload = { contents, generationConfig: { responseMimeType: "application/json" } };
  const delay = (ms) => new Promise(res => setTimeout(res, ms));

  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error(`API error: ${response.status}`);
      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) return JSON.parse(text.replace(/```json/g, '').replace(/```/g, '').trim());
    } catch (error) {
      if (i === retries - 1) throw error;
      await delay(Math.pow(2, i) * 1000); 
    }
  }
  return null;
};

// --- 主應用程式 ---
export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currentTab, setCurrentTab] = useState('diary'); 
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [profile, setProfile] = useState(null);
  const [dailyLog, setDailyLog] = useState(null);
  const [prevLog, setPrevLog] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);

  // 監聽登入狀態
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // 取得個人資料
  useEffect(() => {
    if (!user) return;
    const profileRef = doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'info');
    const unsubscribe = onSnapshot(profileRef, (docSnap) => {
      if (docSnap.exists()) {
        setProfile(docSnap.data());
      } else {
        setProfile(null);
        setCurrentTab('profile'); // 強制前往設定頁面
      }
    });
    return () => unsubscribe();
  }, [user]);

  // 取得每日紀錄
  useEffect(() => {
    if (!user || !profile) return;
    const logRef = doc(db, 'artifacts', appId, 'users', user.uid, 'daily_logs', selectedDate);
    const unsubLog = onSnapshot(logRef, (docSnap) => {
      if (docSnap.exists()) setDailyLog(docSnap.data());
      else setDailyLog(getDefaultLog());
    });

    const prevDate = new Date(selectedDate);
    prevDate.setDate(prevDate.getDate() - 1);
    const prevDateStr = prevDate.toISOString().split('T')[0];
    getDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'daily_logs', prevDateStr))
      .then(docSnap => setPrevLog(docSnap.exists() ? docSnap.data() : null))
      .catch(e => console.error(e));

    return () => unsubLog();
  }, [user, profile, selectedDate]);

  const getDefaultLog = () => ({
    bodyMetrics: { weight: null, protein: null, bmr: null, bodyFat: null, bmi: null, muscle: null, moisture: null, visceralFat: null, boneMass: null },
    meals: {
      breakfast: { items: '', calories: 0, img: null }, lunch: { items: '', calories: 0, img: null },
      dinner: { items: '', calories: 0, img: null }, snacks: { items: '', calories: 0, img: null }
    },
    exercise: { description: '', caloriesBurned: 0 }
  });

  const saveProfile = async (newProfile) => {
    if (!user) return;
    setLoading(true);
    try {
      await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'profile', 'info'), newProfile);
      showToast("個人資料已儲存");
      setCurrentTab('diary');
    } catch (e) {
      showToast("儲存失敗");
    }
    setLoading(false);
  };

  const saveDailyLog = async (updatedLog) => {
    if (!user) return;
    try {
      await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'daily_logs', selectedDate), updatedLog, { merge: true });
    } catch (e) {
      showToast("儲存記錄失敗");
    }
  };

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleLogout = () => {
    signOut(auth);
    setProfile(null);
    setDailyLog(null);
  };

  const calculateDailyNeeds = () => {
    if (!profile) return { tdee: 0, targetIntake: 0, bmr: 0 };
    const weight = dailyLog?.bodyMetrics?.weight || profile.targetWeight || 60; 
    const bmr = (10 * weight) + (6.25 * profile.height) - (5 * profile.age) + (profile.gender === 'male' ? 5 : -161);
    const multipliers = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725 };
    const tdee = Math.round(bmr * (multipliers[profile.activityLevel] || 1.2));
    const targetIntake = profile.goal === 'lose' ? tdee - 500 : (profile.goal === 'gain' ? tdee + 500 : tdee);
    return { tdee, targetIntake, bmr: Math.round(bmr) };
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-green-50 text-green-800">載入中...</div>;

  // --- 若未登入，顯示登入/註冊畫面 ---
  if (!user) {
    return <AuthView showToast={showToast} />;
  }

  // --- 主畫面 ---
  return (
    <div className="min-h-screen bg-gray-50 text-gray-800 font-sans pb-20">
      <header className="bg-white shadow-sm p-4 sticky top-0 z-10 flex justify-between items-center">
        <h1 className="text-xl font-bold text-green-700 flex items-center gap-2">
          <Activity size={24} /> 體重管理大師
        </h1>
        <div className="text-xs text-gray-500 flex items-center gap-1">
          <User size={14} /> {profile?.name || user.email.split('@')[0]}
        </div>
      </header>

      <main className="max-w-md mx-auto relative">
        {currentTab === 'profile' && <ProfileView profile={profile} onSave={saveProfile} onLogout={handleLogout} userEmail={user.email} />}
        {currentTab === 'trends' && profile && <TrendsView user={user} />}
        {currentTab === 'diary' && profile && (
          <DiaryView 
            selectedDate={selectedDate} setSelectedDate={setSelectedDate}
            dailyLog={dailyLog} prevLog={prevLog} updateLog={saveDailyLog}
            profile={profile} needs={calculateDailyNeeds()} showToast={showToast}
          />
        )}
      </main>

      {profile && (
        <nav className="fixed bottom-0 w-full bg-white border-t border-gray-200 flex justify-around p-3 pb-safe max-w-md left-1/2 transform -translate-x-1/2 z-20">
          <button onClick={() => setCurrentTab('diary')} className={`flex flex-col items-center p-2 ${currentTab === 'diary' ? 'text-green-600' : 'text-gray-400'}`}>
            <Calendar size={24} /><span className="text-xs mt-1">日記</span>
          </button>
          <button onClick={() => setCurrentTab('trends')} className={`flex flex-col items-center p-2 ${currentTab === 'trends' ? 'text-green-600' : 'text-gray-400'}`}>
            <LineChart size={24} /><span className="text-xs mt-1">趨勢</span>
          </button>
          <button onClick={() => setCurrentTab('profile')} className={`flex flex-col items-center p-2 ${currentTab === 'profile' ? 'text-green-600' : 'text-gray-400'}`}>
            <Settings size={24} /><span className="text-xs mt-1">設定</span>
          </button>
        </nav>
      )}

      {toastMessage && (
        <div className="fixed top-20 left-1/2 transform -translate-x-1/2 bg-gray-900 text-white px-5 py-2.5 rounded-full shadow-lg z-50 text-sm animate-fade-in-out whitespace-nowrap">
          {toastMessage}
        </div>
      )}
    </div>
  );
}

// --- 登入與註冊介面 ---
function AuthView({ showToast }) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) return showToast("請輸入信箱與密碼");
    if (password.length < 6) return showToast("密碼長度至少需 6 個字元");

    setIsProcessing(true);
    try {
      if (isLogin) {
        await signInWithEmailAndPassword(auth, email, password);
        showToast("登入成功！");
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
        showToast("註冊成功！");
      }
    } catch (error) {
      console.error(error);
      if (error.code === 'auth/email-already-in-use') showToast("此信箱已被註冊");
      else if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') showToast("信箱或密碼錯誤");
      else showToast("發生錯誤，請重試");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-green-50 p-6">
      <div className="w-full max-w-sm bg-white p-8 rounded-3xl shadow-xl border border-green-100">
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 bg-green-100 text-green-600 rounded-2xl flex items-center justify-center mb-4 shadow-sm">
            <Activity size={32} />
          </div>
          <h2 className="text-2xl font-bold text-gray-800">體重管理大師</h2>
          <p className="text-sm text-gray-500 mt-1">你的專屬健康管理日記</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">電子信箱</label>
            <div className="relative">
              <Mail className="absolute left-3 top-3 text-gray-400" size={18} />
              <input 
                type="email" required 
                className="w-full pl-10 p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-green-500 outline-none"
                placeholder="your@email.com"
                value={email} onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">密碼</label>
            <div className="relative">
              <Lock className="absolute left-3 top-3 text-gray-400" size={18} />
              <input 
                type="password" required 
                className="w-full pl-10 p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-green-500 outline-none"
                placeholder="至少 6 個字元"
                value={password} onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>
          
          <button 
            type="submit" disabled={isProcessing}
            className="w-full bg-green-600 text-white font-bold py-3 rounded-xl mt-6 hover:bg-green-700 transition shadow-md disabled:opacity-70 flex justify-center items-center gap-2"
          >
            {isProcessing && <Activity size={18} className="animate-spin" />}
            {isLogin ? '登入' : '註冊新帳號'}
          </button>
        </form>

        <div className="mt-6 text-center">
          <button onClick={() => setIsLogin(!isLogin)} className="text-sm text-green-600 hover:underline">
            {isLogin ? '還沒有帳號？點此註冊' : '已經有帳號了？點此登入'}
          </button>
        </div>
      </div>
    </div>
  );
}

// --- 個人資料設定介面 ---
function ProfileView({ profile, onSave, onLogout, userEmail }) {
  const [formData, setFormData] = useState(profile || {
    name: '', age: '', height: '', gender: 'female', targetWeight: '', activityLevel: 'light', goal: 'lose'
  });

  const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave({ ...formData, age: Number(formData.age), height: Number(formData.height), targetWeight: Number(formData.targetWeight) });
  };

  return (
    <div className="p-4 animate-fade-in pb-10">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-800">您的基本資料</h2>
        {profile && (
          <button onClick={onLogout} className="flex items-center gap-1 text-sm text-red-500 bg-red-50 px-3 py-1.5 rounded-full hover:bg-red-100">
            <LogOut size={14} /> 登出
          </button>
        )}
      </div>

      <div className="bg-gray-100 rounded-xl p-3 mb-6 text-sm text-gray-600 flex items-center gap-2">
        <Mail size={16} /> 登入帳號：{userEmail}
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">姓名</label>
          <input required type="text" name="name" value={formData.name} onChange={handleChange} className="w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-green-500 outline-none" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">年齡</label>
            <input required type="number" name="age" value={formData.age} onChange={handleChange} className="w-full p-3 border border-gray-300 rounded-xl outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">性別</label>
            <select name="gender" value={formData.gender} onChange={handleChange} className="w-full p-3 border border-gray-300 rounded-xl bg-white outline-none">
              <option value="female">女性</option><option value="male">男性</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">身高 (cm)</label>
            <input required type="number" name="height" value={formData.height} onChange={handleChange} className="w-full p-3 border border-gray-300 rounded-xl outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">目標體重 (kg)</label>
            <input required type="number" name="targetWeight" step="0.1" value={formData.targetWeight} onChange={handleChange} className="w-full p-3 border border-gray-300 rounded-xl outline-none" />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">活動量</label>
          <select name="activityLevel" value={formData.activityLevel} onChange={handleChange} className="w-full p-3 border border-gray-300 rounded-xl bg-white outline-none">
            <option value="sedentary">久坐 (幾乎不運動)</option>
            <option value="light">輕度活動 (每週運動1-3天)</option>
            <option value="moderate">中度活動 (每週運動3-5天)</option>
            <option value="active">高度活動 (每週運動6-7天)</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">目標</label>
          <select name="goal" value={formData.goal} onChange={handleChange} className="w-full p-3 border border-gray-300 rounded-xl bg-white outline-none">
            <option value="lose">減重</option><option value="maintain">維持</option><option value="gain">增肌</option>
          </select>
        </div>
        <button type="submit" className="w-full bg-green-600 text-white font-bold py-3 rounded-xl mt-6 hover:bg-green-700 transition">
          儲存設定
        </button>
      </form>
    </div>
  );
}

// --- 日記介面 ---
function DiaryView({ selectedDate, setSelectedDate, dailyLog, prevLog, updateLog, profile, needs, showToast }) {
  if (!dailyLog) return <div className="p-4 text-center">載入資料中...</div>;

  return (
    <div className="flex flex-col gap-4 p-4 pb-10">
      <DateSelector selectedDate={selectedDate} setSelectedDate={setSelectedDate} />
      <BodyMetricsCard data={dailyLog.bodyMetrics} prevData={prevLog?.bodyMetrics} onUpdate={(metrics) => updateLog({ ...dailyLog, bodyMetrics: { ...dailyLog.bodyMetrics, ...metrics }})} showToast={showToast} />
      <SummaryCard dailyLog={dailyLog} needs={needs} profile={profile} />
      <MealsCard meals={dailyLog.meals} onUpdate={(meals) => updateLog({ ...dailyLog, meals })} showToast={showToast} />
      <ExerciseCard exercise={dailyLog.exercise} onUpdate={(exercise) => updateLog({ ...dailyLog, exercise })} showToast={showToast} />
    </div>
  );
}

function DateSelector({ selectedDate, setSelectedDate }) {
  const dates = Array.from({length: 14}, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (13 - i));
    return d.toISOString().split('T')[0];
  });
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current && selectedDate === dates[13]) scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
  }, []);

  return (
    <div className="flex overflow-x-auto gap-2 py-2 no-scrollbar scroll-smooth" ref={scrollRef}>
      {dates.map(dateStr => {
        const dateObj = new Date(dateStr);
        const day = dateObj.getDate(); const month = dateObj.getMonth() + 1;
        const isSelected = dateStr === selectedDate;
        const isToday = dateStr === new Date().toISOString().split('T')[0];
        return (
          <button key={dateStr} onClick={() => setSelectedDate(dateStr)} className={`min-w-[60px] flex flex-col items-center justify-center p-2 rounded-xl border transition-all ${isSelected ? 'bg-green-600 text-white border-green-600 shadow-md' : 'bg-white text-gray-600 border-gray-200 hover:bg-green-50'}`}>
            <span className="text-xs font-medium">{month}月</span>
            <span className={`text-lg font-bold ${isSelected ? 'text-white' : 'text-gray-800'}`}>{day}</span>
            {isToday && <span className="text-[10px] mt-1 opacity-80">今天</span>}
          </button>
        );
      })}
    </div>
  );
}

function BodyMetricsCard({ data, prevData, onUpdate, showToast }) {
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef(null);

  const handleWebImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setIsProcessing(true);
    showToast("正在分析圖片...");
    
    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const prompt = `Analyze this smart body scale screenshot. Extract metrics. Return ONLY JSON: "weight", "protein", "bmr", "bodyFat", "bmi", "muscle", "moisture", "visceralFat", "boneMass". Set to null if not found. Only numbers.`;
        const extractedData = await callGeminiAPI(prompt, reader.result);
        if (extractedData) {
          const cleanData = {};
          for (const key in data) cleanData[key] = extractedData[key] !== undefined && extractedData[key] !== null ? parseFloat(extractedData[key]) : data[key];
          onUpdate(cleanData);
          showToast("數據擷取成功！");
        } else {
           onUpdate({ weight: 68.5, protein: 18.2, bmr: 1550, bodyFat: 22.4, bmi: 23.5, muscle: 45.2, moisture: 55.1, visceralFat: 8, boneMass: 2.8 });
           showToast("無法連接分析服務，使用模擬數據");
        }
        setIsProcessing(false);
        if(fileInputRef.current) fileInputRef.current.value = ''; // Reset input
      };
      reader.readAsDataURL(file);
    } catch (error) {
      showToast("分析失敗");
      setIsProcessing(false);
    }
  };

  const renderMetric = (label, key, unit, icon) => {
    const val = data[key]; const prevVal = prevData?.[key];
    const hasVal = val !== null && val !== undefined;
    let diff = null; let TrendIcon = null; let trendColor = '';

    if (hasVal && prevVal) {
      diff = (val - prevVal).toFixed(1);
      if (diff > 0) { TrendIcon = TrendingUp; trendColor = ['weight', 'bodyFat', 'visceralFat', 'bmi'].includes(key) ? 'text-red-500' : 'text-green-500'; }
      else if (diff < 0) { TrendIcon = TrendingDown; trendColor = ['weight', 'bodyFat', 'visceralFat', 'bmi'].includes(key) ? 'text-green-500' : 'text-red-500'; }
    }

    return (
      <div className="bg-gray-50 p-3 rounded-xl flex flex-col justify-between items-start" key={key}>
        <div className="text-gray-500 text-xs flex items-center gap-1 mb-1">{icon} {label}</div>
        <div className="flex items-end justify-between w-full">
          <span className="text-xl font-bold text-gray-800">{hasVal ? val : '--'} <span className="text-xs font-normal text-gray-500">{unit}</span></span>
          {diff && diff != 0 && <span className={`flex items-center text-[10px] ${trendColor}`}><TrendIcon size={12} /> {Math.abs(diff)}</span>}
        </div>
      </div>
    );
  };

  const hasAnyData = Object.values(data).some(v => v !== null);

  return (
    <div className="bg-white rounded-2xl shadow-sm p-4 border border-gray-100">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2"><User className="text-blue-500" size={20} /> 身體數據</h3>
        <input type="file" accept="image/*" className="hidden" ref={fileInputRef} onChange={handleWebImageUpload} />
        <button onClick={() => fileInputRef.current?.click()} disabled={isProcessing} className="flex items-center gap-1 text-sm bg-blue-50 text-blue-600 px-3 py-1.5 rounded-full hover:bg-blue-100 transition disabled:opacity-50">
          {isProcessing ? <Activity className="animate-spin" size={16} /> : <Upload size={16} />} {isProcessing ? '分析中...' : '上傳截圖'}
        </button>
      </div>

      {!hasAnyData ? (
        <div className="text-center py-8 text-gray-400 border-2 border-dashed border-gray-200 rounded-xl">
          <p className="mb-2">尚未有今日數據</p>
          <button onClick={() => fileInputRef.current?.click()} className="text-blue-500 underline text-sm">上傳體重計 APP 截圖以自動填入</button>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {renderMetric('體重', 'weight', 'kg', <Activity size={12}/>)} {renderMetric('體脂率', 'bodyFat', '%', <Droplets size={12}/>)} {renderMetric('肌肉量', 'muscle', 'kg', <Flame size={12}/>)}
          {renderMetric('BMI', 'bmi', '', <Activity size={12}/>)} {renderMetric('內臟脂肪', 'visceralFat', '', <Activity size={12}/>)} {renderMetric('基礎代謝', 'bmr', 'kcal', <Flame size={12}/>)}
          {renderMetric('水分', 'moisture', '%', <Droplets size={12}/>)} {renderMetric('蛋白質', 'protein', '%', <Activity size={12}/>)} {renderMetric('骨量', 'boneMass', 'kg', <Bone size={12}/>)}
        </div>
      )}
    </div>
  );
}

function SummaryCard({ dailyLog, needs, profile }) {
  const intake = Object.values(dailyLog.meals).reduce((sum, meal) => sum + (Number(meal.calories) || 0), 0);
  const burned = Number(dailyLog.exercise?.caloriesBurned) || 0;
  const tdee = needs.tdee; const deficit = (tdee + burned) - intake; const remaining = needs.targetIntake - intake + burned;

  let rec = "";
  if (intake === 0) rec = "美好的一天！記得記錄你的第一餐喔。";
  else if (remaining > 500) rec = "目前熱量攝取不足，建議下一餐可以多補充優質蛋白質與複合碳水化合物。";
  else if (remaining < 0) rec = burned < 200 ? "今日熱量已超標！建議稍後進行至少30分鐘的有氧運動。" : "今日熱量稍高，但你有保持運動習慣，很棒！請充分休息。";
  else rec = "完美！目前熱量控制在理想範圍內，繼續保持這個節奏。";
  if (dailyLog.bodyMetrics.protein && dailyLog.bodyMetrics.protein < 16) rec += " 另外，蛋白質比例偏低，建議多吃雞蛋或豆類。";

  return (
    <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-2xl shadow-md p-5 text-white">
      <div className="flex justify-between items-end mb-4">
        <div><h3 className="text-green-100 text-sm font-medium mb-1">今日剩餘可攝取 (kcal)</h3><div className="text-4xl font-bold">{remaining > 0 ? remaining : 0}</div></div>
        <div className="text-right"><div className="text-green-100 text-xs mb-1">目標: {needs.targetIntake}</div><div className="text-green-100 text-xs">熱量赤字: {deficit > 0 ? '+' : ''}{deficit}</div></div>
      </div>
      <div className="flex justify-between bg-white/20 rounded-xl p-3 mb-4 text-sm">
        <div className="text-center flex-1"><div className="text-green-100 text-xs mb-1">已攝取</div><div className="font-semibold">{intake}</div></div>
        <div className="w-px bg-white/30 mx-2"></div>
        <div className="text-center flex-1"><div className="text-green-100 text-xs mb-1">已消耗 (運動)</div><div className="font-semibold">{burned}</div></div>
      </div>
      <div className="bg-white/10 rounded-xl p-3 text-sm flex gap-2 items-start"><AlertCircle size={18} className="shrink-0 mt-0.5 text-green-200" /><p className="leading-snug">{rec}</p></div>
    </div>
  );
}

function MealsCard({ meals, onUpdate, showToast }) {
  const mealTypes = [{ id: 'breakfast', label: '早餐' }, { id: 'lunch', label: '午餐' }, { id: 'dinner', label: '晚餐' }, { id: 'snacks', label: '其他零食' }];
  return (
    <div className="bg-white rounded-2xl shadow-sm p-4 border border-gray-100">
      <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2"><Flame className="text-orange-500" size={20} /> 飲食記錄</h3>
      <div className="grid grid-cols-2 gap-3">
        {mealTypes.map(type => <MealBox key={type.id} title={type.label} data={meals[type.id]} onUpdate={(data) => onUpdate({ ...meals, [type.id]: data })} showToast={showToast} />)}
      </div>
    </div>
  );
}

function MealBox({ title, data, onUpdate, showToast }) {
  const [isEditing, setIsEditing] = useState(false); const [editData, setEditData] = useState(data); const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef(null);
  const hasData = data.items || data.calories > 0;

  const estimateText = async () => {
    if (!editData.items) return;
    setIsProcessing(true); showToast(`正在估算${title}熱量...`);
    const result = await callGeminiAPI(`Estimate total calories for this food: "${editData.items}". Return ONLY JSON: {"calories": number}.`);
    if (result && result.calories !== undefined) { setEditData(prev => ({...prev, calories: result.calories})); showToast(`約 ${result.calories} 大卡`); } 
    else showToast("估算失敗，請手動輸入");
    setIsProcessing(false);
  };

  const handleWebImageUpload = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    setIsProcessing(true); showToast(`正在分析圖片...`);
    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const result = await callGeminiAPI(`Analyze food image. Return ONLY JSON: {"items": "comma separated list of food in Traditional Chinese", "calories": number}.`, reader.result);
        if (result) {
          const newData = { items: result.items, calories: result.calories, img: reader.result };
          setEditData(newData); onUpdate(newData); showToast(`已分析：${result.items}，約 ${result.calories} 大卡`);
        } else {
          const newData = { items: "健康餐盒 (模擬)", calories: 450, img: reader.result };
          setEditData(newData); onUpdate(newData); showToast("使用模擬結果");
        }
        setIsProcessing(false);
        if(fileInputRef.current) fileInputRef.current.value = '';
      };
      reader.readAsDataURL(file);
    } catch (error) { setIsProcessing(false); showToast("分析失敗"); }
  };

  if (isEditing) {
    return (
      <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 flex flex-col gap-2">
        <div className="font-bold text-sm text-gray-800">{title}</div>
        <input type="text" placeholder="吃了什麼？" className="w-full text-sm p-1.5 border rounded outline-none" value={editData.items} onChange={e => setEditData({...editData, items: e.target.value})} onBlur={estimateText} disabled={isProcessing} />
        <div className="flex items-center gap-1 text-sm"><input type="number" className="w-16 p-1 border rounded outline-none" value={editData.calories || ''} onChange={e => setEditData({...editData, calories: Number(e.target.value)})} disabled={isProcessing} /><span className="text-gray-500 text-xs">大卡</span></div>
        <div className="flex justify-end mt-1"><button onClick={() => { onUpdate(editData); setIsEditing(false); }} disabled={isProcessing} className="bg-orange-500 text-white text-xs px-3 py-1 rounded-full flex items-center gap-1"><Check size={12} /> 儲存</button></div>
      </div>
    );
  }

  return (
    <div className={`rounded-xl p-3 border flex flex-col justify-between ${hasData ? 'bg-orange-50 border-orange-100' : 'bg-gray-50 border-gray-200 border-dashed'}`}>
      <div className="flex justify-between items-start mb-2"><div className="font-bold text-sm text-gray-700">{title}</div>{hasData && <button onClick={() => { setEditData(data); setIsEditing(true); }} className="text-gray-400 hover:text-orange-500"><Edit2 size={14} /></button>}</div>
      {hasData ? (<div><p className="text-xs text-gray-600 mb-1 truncate" title={data.items}>{data.items}</p><div className="font-bold text-orange-600 text-lg">{data.calories} <span className="text-[10px] font-normal text-gray-500">kcal</span></div></div>) : (
        <div className="flex flex-col gap-2 mt-2">
          {/* 使用 HTML 原生檔案上傳，手機端會自動支援開啟相機 */}
          <input type="file" accept="image/*" className="hidden" ref={fileInputRef} onChange={handleWebImageUpload} />
          <button onClick={() => fileInputRef.current?.click()} disabled={isProcessing} className="w-full py-1.5 bg-white border shadow-sm rounded-lg text-xs text-gray-600 flex items-center justify-center gap-1 hover:bg-gray-50">
            {isProcessing ? <Activity size={14} className="animate-spin" /> : <Camera size={14} />} 拍照/上傳
          </button>
          <button onClick={() => setIsEditing(true)} className="w-full py-1.5 text-xs text-gray-500 underline">手動輸入</button>
        </div>
      )}
    </div>
  );
}

function ExerciseCard({ exercise, onUpdate, showToast }) {
  const [isEditing, setIsEditing] = useState(false); const [editData, setEditData] = useState(exercise || { description: '', caloriesBurned: 0 });
  const hasData = exercise?.description || exercise?.caloriesBurned > 0;

  const estimateCalories = async () => {
    if (!editData.description) return;
    showToast("正在估算消耗熱量...");
    const result = await callGeminiAPI(`Estimate calories burned for: "${editData.description}". Return ONLY JSON: {"calories": number}.`);
    if (result && result.calories) { setEditData({...editData, caloriesBurned: result.calories}); showToast(`約消耗 ${result.calories} 大卡`); } 
    else { setEditData({...editData, caloriesBurned: 200}); showToast("使用模擬消耗數據"); }
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm p-4 border border-gray-100">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2"><Activity className="text-purple-500" size={20} /> 運動記錄</h3>
        {hasData && !isEditing && <button onClick={() => { setEditData(exercise); setIsEditing(true); }} className="text-gray-400 hover:text-purple-500 text-sm flex items-center gap-1"><Edit2 size={14} /> 編輯</button>}
      </div>
      {(!hasData || isEditing) ? (
        <div className="flex flex-col gap-3">
          <textarea placeholder="今天做了什麼運動？" className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:border-purple-300 resize-none" rows="2" value={editData.description} onChange={e => setEditData({...editData, description: e.target.value})} onBlur={estimateCalories} />
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2"><span className="text-sm text-gray-600">消耗</span><input type="number" className="w-20 p-2 border rounded-lg outline-none text-sm" value={editData.caloriesBurned || ''} onChange={e => setEditData({...editData, caloriesBurned: Number(e.target.value)})} /><span className="text-sm text-gray-500">大卡</span></div>
            <button onClick={() => { onUpdate(editData); setIsEditing(false); }} className="bg-purple-500 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-sm hover:bg-purple-600">儲存</button>
          </div>
        </div>
      ) : (
        <div className="bg-purple-50 p-3 rounded-xl border border-purple-100 flex justify-between items-center">
          <p className="text-sm text-gray-700">{exercise.description}</p><div className="font-bold text-purple-600 text-xl whitespace-nowrap ml-2">{exercise.caloriesBurned} <span className="text-xs font-normal text-gray-500">kcal</span></div>
        </div>
      )}
    </div>
  );
}

function TrendsView({ user }) {
  const [logs, setLogs] = useState([]); const [selectedMetric, setSelectedMetric] = useState('weight');
  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(collection(db, 'artifacts', appId, 'users', user.uid, 'daily_logs'), (snap) => {
      const data = snap.docs.map(doc => ({ date: doc.id, ...doc.data() })).sort((a, b) => a.date.localeCompare(b.date));
      setLogs(data);
    });
    return () => unsub();
  }, [user]);

  const metrics = [
    { id: 'weight', label: '體重', unit: 'kg', color: '#3b82f6' }, { id: 'bodyFat', label: '體脂率', unit: '%', color: '#ef4444' },
    { id: 'muscle', label: '肌肉量', unit: 'kg', color: '#f97316' }, { id: 'bmi', label: 'BMI', unit: '', color: '#10b981' },
    { id: 'bmr', label: '基礎代謝', unit: 'kcal', color: '#8b5cf6' },
  ];
  const currentMetric = metrics.find(m => m.id === selectedMetric);
  const chartData = logs.filter(log => log.bodyMetrics && log.bodyMetrics[selectedMetric] != null).map(log => ({ date: log.date.substring(5), value: log.bodyMetrics[selectedMetric] })).slice(-14);

  const renderChart = () => {
    if (chartData.length < 2) return <div className="h-48 flex items-center justify-center text-gray-400 text-sm border-2 border-dashed border-gray-200 rounded-xl">需要至少兩天的數據才能顯示趨勢圖喔！</div>;
    const values = chartData.map(d => d.value); const minVal = Math.min(...values); const maxVal = Math.max(...values);
    const padding = (maxVal - minVal) * 0.1 || 1; const yMin = minVal - padding; const yMax = maxVal + padding; const range = yMax - yMin;
    const points = chartData.map((d, i) => `${(i / (chartData.length - 1)) * 300},${150 - ((d.value - yMin) / range) * 150}`).join(' ');

    return (
      <div className="mt-8 relative px-4">
        <svg viewBox="0 0 300 170" className="w-full h-auto overflow-visible">
          <line x1="0" y1="0" x2="300" y2="0" stroke="#f3f4f6" strokeWidth="1" /> <line x1="0" y1="75" x2="300" y2="75" stroke="#f3f4f6" strokeWidth="1" /> <line x1="0" y1="150" x2="300" y2="150" stroke="#f3f4f6" strokeWidth="1" />
          <text x="-5" y="5" fontSize="10" fill="#9ca3af" textAnchor="end">{yMax.toFixed(1)}</text> <text x="-5" y="78" fontSize="10" fill="#9ca3af" textAnchor="end">{((yMax+yMin)/2).toFixed(1)}</text> <text x="-5" y="150" fontSize="10" fill="#9ca3af" textAnchor="end">{yMin.toFixed(1)}</text>
          <polyline points={points} fill="none" stroke={currentMetric.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          {chartData.map((d, i) => {
            const x = (i / (chartData.length - 1)) * 300; const y = 150 - ((d.value - yMin) / range) * 150;
            return (
              <g key={i}>
                <circle cx={x} cy={y} r="4" fill="white" stroke={currentMetric.color} strokeWidth="2" />
                <text x={x} y={y - 10} fontSize="10" fill="#4b5563" textAnchor="middle" fontWeight="bold">{d.value}</text>
                {(chartData.length <= 7 || i % 2 === 0 || i === chartData.length - 1) && <text x={x} y={166} fontSize="8" fill="#9ca3af" textAnchor="middle">{d.date}</text>}
              </g>
            );
          })}
        </svg>
      </div>
    );
  };

  return (
    <div className="p-4 animate-fade-in pb-10">
      <h2 className="text-2xl font-bold mb-6 text-gray-800 flex items-center gap-2"><LineChart className="text-blue-500" size={24} /> 數據趨勢</h2>
      <div className="bg-white rounded-2xl shadow-sm p-4 border border-gray-100">
        <div className="flex flex-wrap gap-2 mb-6">
          {metrics.map(m => <button key={m.id} onClick={() => setSelectedMetric(m.id)} className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${selectedMetric === m.id ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>{m.label}</button>)}
        </div>
        {renderChart()}
      </div>
    </div>
  );
}