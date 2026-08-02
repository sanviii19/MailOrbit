import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Paperclip, Clock, Upload, Calendar } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { api } from '../services/api';
import { Button } from '../components/ui/Button';

const Compose = () => {
  const navigate = useNavigate();
  const [senders, setSenders] = useState<{ id: string; email: string }[]>([]);
  const [formData, setFormData] = useState({
    senderId: '',
    subject: '',
    delay: 0,
    hourlyLimit: 0,
    body: '',
  });
  const [emails, setEmails] = useState<string[]>([]);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvEmailCount, setCsvEmailCount] = useState<number | null>(null);
  const [attachments, setAttachments] = useState<File[]>([]);
  
  // Modal state
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduledDate, setScheduledDate] = useState<Date | null>(null);

  // Generate a unique idempotency key for this compose session
  const idempotencyKeyRef = useRef(crypto.randomUUID());

  useEffect(() => {
    // Fetch senders to populate the "From" dropdown
    const fetchSenders = async () => {
      try {
        const res = await api.get('/senders');
        const data = res.data.data.senders;
        setSenders(data);
        if (data.length > 0) {
          setFormData((prev) => ({ ...prev, senderId: data[0].id }));
        }
      } catch (err) {
        console.error('Failed to load senders', err);
      }
    };
    fetchSenders();
  }, []);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvFile(file);

    // Simple preview parse (actual parsing happens on backend)
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      // Rough extraction for preview
      const extracted = text.split(/[\s,;]+/).filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
      setCsvEmailCount(new Set(extracted).size);
    };
    reader.readAsText(file);
  };

  const handleSend = async (isScheduled: boolean = false) => {
    if (!formData.subject.trim()) {
      toast.error('Please enter a subject.');
      return;
    }
    
    // Strip HTML tags to check if the body is actually empty
    const plainTextBody = formData.body.replace(/<[^>]*>?/gm, '').trim();
    if (!plainTextBody) {
      toast.error('Please enter a message body.');
      return;
    }

    if (emails.length === 0 && !csvFile) {
      toast.error('Please add at least one recipient or upload a CSV file.');
      return;
    }

    const formPayload = new FormData();
    formPayload.append('senderId', formData.senderId);
    formPayload.append('subject', formData.subject);
    formPayload.append('body', formData.body);
    formPayload.append('delayBetweenEmailsMs', formData.delay.toString());
    formPayload.append('hourlyLimit', formData.hourlyLimit.toString());
    formPayload.append('idempotencyKey', idempotencyKeyRef.current);
    
    // Set scheduled time, default to now
    const startTime = isScheduled && scheduledDate ? scheduledDate.toISOString() : new Date().toISOString();
    formPayload.append('scheduledStart', startTime);
    
    if (csvFile) {
      formPayload.append('csv', csvFile);
    }
    if (emails.length > 0) {
      formPayload.append('recipients', emails.join(','));
    }
    attachments.forEach(file => {
      formPayload.append('attachments', file);
    });

    try {
      await api.post('/campaigns', formPayload, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      toast.success('Campaign scheduled successfully!');
      navigate('/');
    } catch (err) {
      console.error('Failed to create campaign', err);
      toast.error('Failed to schedule campaign');
    }
  };

  const setTomorrowTime = (hours: number) => {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    date.setHours(hours, 0, 0, 0);
    setScheduledDate(date);
  };

  return (
    <div className="flex flex-col h-screen bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 relative">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate(-1)} className="text-gray-500 hover:text-gray-800 transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-medium text-gray-800">Compose New Email</h1>
        </div>
        <div className="flex items-center gap-3 relative">
          <label className="text-gray-400 hover:text-green-500 transition-colors cursor-pointer">
            <Paperclip className="w-5 h-5" />
            <input 
              type="file" 
              multiple 
              className="hidden" 
              onChange={(e) => {
                if (e.target.files) {
                  setAttachments(prev => [...prev, ...Array.from(e.target.files!)]);
                }
              }} 
            />
          </label>
          
          <button 
            onClick={() => setShowScheduleModal(!showScheduleModal)}
            className={`transition-colors ${showScheduleModal ? 'text-green-500' : 'text-gray-400 hover:text-green-500'}`}
          >
            <Clock className="w-5 h-5" />
          </button>

          {/* Schedule Modal */}
          {showScheduleModal && (
            <div className="absolute top-12 right-0 w-[300px] bg-white rounded-xl shadow-[0_4px_20px_rgb(0,0,0,0.1)] border border-gray-100 z-50 p-5">
              <h3 className="text-[15px] font-medium text-gray-800 mb-4">Send Later</h3>
              
              <div className="relative mb-3 border-b border-gray-100 pb-4">
                <input 
                  type="text" 
                  onFocus={(e) => (e.target.type = 'datetime-local')}
                  onBlur={(e) => { if (!e.target.value) e.target.type = 'text'; }}
                  placeholder="Pick date & time"
                  className="w-full border border-gray-200 rounded-md pl-3 pr-10 py-2.5 text-[13px] text-gray-700 outline-none focus:border-green-500 bg-transparent placeholder-gray-400 relative z-10 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:right-2 [&::-webkit-calendar-picker-indicator]:w-6 [&::-webkit-calendar-picker-indicator]:h-6 [&::-webkit-calendar-picker-indicator]:opacity-0 [&::-webkit-calendar-picker-indicator]:cursor-pointer"
                  value={scheduledDate ? new Date(scheduledDate.getTime() - scheduledDate.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''}
                  onChange={(e) => setScheduledDate(new Date(e.target.value))}
                />
                <Calendar className="w-4 h-4 text-gray-400 absolute right-3 top-[10px] pointer-events-none z-0" />
              </div>

              <div className="flex flex-col gap-1 mb-6">
                <button 
                  onClick={() => setTomorrowTime(9)}
                  className="w-full text-left px-2 py-2 text-[13px] text-gray-600 hover:text-gray-900 transition-colors"
                >
                  Tomorrow
                </button>
                <button 
                  onClick={() => setTomorrowTime(10)}
                  className="w-full text-left px-2 py-2 text-[13px] text-gray-600 hover:text-gray-900 transition-colors"
                >
                  Tomorrow, 10:00 AM
                </button>
                <button 
                  onClick={() => setTomorrowTime(11)}
                  className="w-full text-left px-2 py-2 text-[13px] text-gray-600 hover:text-gray-900 transition-colors"
                >
                  Tomorrow, 11:00 AM
                </button>
                <button 
                  onClick={() => setTomorrowTime(15)}
                  className="w-full text-left px-2 py-2 text-[13px] text-gray-600 hover:text-gray-900 transition-colors"
                >
                  Tomorrow, 3:00 PM
                </button>
              </div>

              <div className="flex items-center justify-end gap-5 pt-2">
                <button 
                  onClick={() => setShowScheduleModal(false)}
                  className="text-[13px] font-bold text-gray-800 hover:text-black transition-colors"
                >
                  Cancel
                </button>
                <Button 
                  onClick={() => {
                    setShowScheduleModal(false);
                    if (scheduledDate) handleSend(true);
                  }}
                  disabled={!scheduledDate}
                  variant="outline"
                >
                  Done
                </Button>
              </div>
            </div>
          )}
          
          <Button onClick={() => handleSend(false)}>
            Send
          </Button>
        </div>
      </div>

      {/* Form */}
      <div className="flex-1 overflow-auto p-8 max-w-4xl mx-auto w-full">
        <div className="space-y-6">
          {/* From */}
          <div className="flex items-center gap-4 pb-4 border-b border-gray-100">
            <label className="text-sm font-medium text-gray-700 w-16">From</label>
            <div className="flex items-center gap-3">
              <select 
                className="bg-gray-50 border-none text-sm rounded-md px-3 py-1.5 outline-none focus:ring-1 focus:ring-green-500 text-gray-700 cursor-pointer"
                value={formData.senderId}
                onChange={e => setFormData(prev => ({ ...prev, senderId: e.target.value }))}
              >
                {senders.length === 0 && <option value="">No senders found</option>}
                {senders.map(sender => (
                  <option key={sender.id} value={sender.id}>{sender.email}</option>
                ))}
              </select>
              
              <Button 
                type="button"
                variant="ghost"
                onClick={async () => {
                  try {
                    const res = await api.post('/senders', { name: 'Test Sender ' + Math.floor(Math.random() * 1000) });
                    const newSender = res.data.data.sender;
                    setSenders(prev => [...prev, newSender]);
                    setFormData(prev => ({ ...prev, senderId: newSender.id }));
                    toast.success('Test sender auto-generated!');
                  } catch (err) {
                    console.error('Failed to create test sender', err);
                    toast.error('Failed to create test sender');
                  }
                }}
              >
                + Auto-Generate Test Sender
              </Button>
            </div>
          </div>

          {/* To */}
          <div className="flex items-start gap-4 pb-4 border-b border-gray-100">
            <label className="text-sm font-medium text-gray-700 w-16 pt-1">To</label>
            <div className="flex-1 flex flex-col gap-2">
              <div className="flex items-start justify-between gap-4">
                <div className="flex flex-wrap gap-2 flex-1 border border-gray-200 rounded-md p-1.5 focus-within:border-green-500 focus-within:ring-1 focus-within:ring-green-500 bg-white min-h-[42px]">
                  {emails.slice(0, 50).map((email, i) => (
                    <div key={i} className="flex items-center gap-1 px-2.5 py-1 rounded-full border border-green-200 bg-green-50 text-green-800 text-sm">
                      {email}
                      <button 
                        type="button" 
                        onClick={() => setEmails(prev => prev.filter((_, index) => index !== i))}
                        className="hover:text-green-900 transition-colors focus:outline-none"
                      >
                        &times;
                      </button>
                    </div>
                  ))}
                  {emails.length > 50 && (
                    <div className="px-2.5 py-1 rounded-full border border-green-200 text-green-700 text-sm font-medium self-center">
                      +{emails.length - 50} more
                    </div>
                  )}
                  <input
                    type="text"
                    placeholder={emails.length === 0 ? "recipient@example.com (press Enter to add)" : "add more..."}
                    className="flex-1 min-w-[200px] border-none outline-none text-sm p-1 bg-transparent"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ',') {
                        e.preventDefault();
                        const val = e.currentTarget.value.trim();
                        if (val && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
                          if (!emails.includes(val)) {
                            setEmails(prev => [...prev, val]);
                          }
                          e.currentTarget.value = '';
                        }
                      }
                    }}
                    onBlur={(e) => {
                      const val = e.target.value.trim();
                      if (val && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
                        if (!emails.includes(val)) {
                          setEmails(prev => [...prev, val]);
                        }
                        e.target.value = '';
                      }
                    }}
                  />
                </div>
                <div className="flex flex-col gap-2 mt-1">
                  <label className="flex items-center gap-2 text-sm text-green-600 font-medium cursor-pointer hover:text-green-700 whitespace-nowrap">
                    <Upload className="w-4 h-4" />
                    Upload CSV
                    <input type="file" accept=".csv,.txt" className="hidden" onChange={handleFileUpload} />
                  </label>
                  {csvFile && csvEmailCount !== null && (
                    <div className="flex flex-col text-xs text-gray-500 bg-gray-50 px-3 py-2 rounded-md border border-gray-100">
                      <span className="font-medium text-gray-700 truncate max-w-[200px]">{csvFile.name}</span>
                      <span>{csvEmailCount} emails detected</span>
                      <button 
                        type="button" 
                        onClick={() => {
                          setCsvFile(null);
                          setCsvEmailCount(null);
                        }}
                        className="text-red-500 hover:text-red-700 mt-1 text-left"
                      >
                        Remove file
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Subject */}
          <div className="flex items-center gap-4 pb-4 border-b border-gray-100">
            <label className="text-sm font-medium text-gray-700 w-16">Subject</label>
            <input 
              type="text" 
              placeholder="Subject"
              className="flex-1 border-none outline-none text-sm placeholder-gray-400"
              value={formData.subject}
              onChange={e => setFormData(prev => ({ ...prev, subject: e.target.value }))}
            />
          </div>

          {/* Settings */}
          <div className="flex items-center gap-8 pb-4 border-b border-gray-100">
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium text-gray-700">Delay between 2 emails</label>
              <input 
                type="number" 
                placeholder="00"
                className="w-16 border border-gray-200 rounded-md px-3 py-1.5 text-sm outline-none focus:border-green-500 text-center"
                value={formData.delay || ''}
                onChange={e => setFormData(prev => ({ ...prev, delay: parseInt(e.target.value) || 0 }))}
              />
            </div>
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium text-gray-700">Hourly Limit</label>
              <input 
                type="number" 
                placeholder="00"
                className="w-16 border border-gray-200 rounded-md px-3 py-1.5 text-sm outline-none focus:border-green-500 text-center"
                value={formData.hourlyLimit || ''}
                onChange={e => setFormData(prev => ({ ...prev, hourlyLimit: parseInt(e.target.value) || 0 }))}
              />
            </div>
          </div>

          {/* Attachments List */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 pb-4 border-b border-gray-100">
              {attachments.map((file, i) => (
                <div key={i} className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-gray-200 bg-gray-50 text-sm text-gray-700">
                  <Paperclip className="w-4 h-4 text-gray-400" />
                  <span className="truncate max-w-[200px]">{file.name}</span>
                  <button
                    type="button"
                    onClick={() => setAttachments(prev => prev.filter((_, index) => index !== i))}
                    className="text-gray-400 hover:text-gray-600 focus:outline-none ml-1"
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Editor */}
          <div className="flex-1 min-h-[300px] border border-gray-100 rounded-xl bg-gray-50 flex flex-col overflow-hidden">
            <div className="flex items-center gap-1 px-4 py-2 border-b border-gray-100 bg-white text-gray-400">
              {/* Toolbar placeholders */}
              <button className="p-1.5 hover:bg-gray-100 rounded font-serif">B</button>
              <button className="p-1.5 hover:bg-gray-100 rounded italic font-serif">I</button>
              <button className="p-1.5 hover:bg-gray-100 rounded underline font-serif">U</button>
              <div className="w-px h-4 bg-gray-200 mx-2"></div>
              <button className="p-1.5 hover:bg-gray-100 rounded font-serif">T<span className="text-[10px]">T</span></button>
            </div>
            <textarea 
              className="flex-1 w-full bg-transparent p-4 outline-none resize-none placeholder-gray-400 text-gray-800"
              placeholder="Type Your Reply..."
              value={formData.body}
              onChange={e => setFormData(prev => ({ ...prev, body: e.target.value }))}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default Compose;
