import { useEffect, useState } from 'react';
import { Search, Filter, RefreshCcw, Star, ArrowLeft, Trash, Archive, ChevronDown, Paperclip, Download } from 'lucide-react';
import { toast } from 'react-toastify';
import { api } from '../services/api';
import type { EmailJob } from '../types';
import { Spinner } from '../components/ui/Spinner';
import { Badge } from '../components/ui/Badge';
import { Input } from '../components/ui/Input';

interface DashboardProps {
  type: 'scheduled' | 'sent';
}

const Dashboard = ({ type }: DashboardProps) => {
  const [emails, setEmails] = useState<EmailJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [selectedEmail, setSelectedEmail] = useState<EmailJob | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchEmails = async () => {
    setLoading(true);
    try {
      const response = await api.get(`/emails/${type}?limit=50${search ? `&search=${search}` : ''}`);
      setEmails(response.data.data.emails);
    } catch (error) {
      console.error('Failed to fetch emails', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedEmailId) {
      fetchEmails();
    }
  }, [type, search, selectedEmailId]);

  useEffect(() => {
    if (selectedEmailId) {
      setDetailLoading(true);
      api.get(`/emails/${selectedEmailId}`).then(res => {
        const email = res.data.data.email;
        if (email.campaign_attachments && typeof email.campaign_attachments === 'string') {
          try {
            email.campaign_attachments = JSON.parse(email.campaign_attachments);
          } catch (e) {}
        }
        setSelectedEmail(email);
      }).catch(err => {
        console.error('Failed to fetch email detail', err);
      }).finally(() => {
        setDetailLoading(false);
      });
    } else {
      setSelectedEmail(null);
    }
  }, [selectedEmailId]);

  const toggleStar = async (id: string, currentStarred: boolean) => {
    try {
      if (selectedEmailId && selectedEmail?.id === id) {
        setSelectedEmail({ ...selectedEmail, starred: !currentStarred });
      }
      setEmails((prev) => prev.map((e) => (e.id === id ? { ...e, starred: !currentStarred } : e)));
      await api.patch(`/emails/${id}/star`);
    } catch (error) {
      if (selectedEmailId && selectedEmail?.id === id) {
        setSelectedEmail({ ...selectedEmail, starred: currentStarred });
      }
      setEmails((prev) => prev.map((e) => (e.id === id ? { ...e, starred: currentStarred } : e)));
      toast.error('Failed to update star status');
    }
  };

  const formatDateList = (dateString: string) => {
    const date = new Date(dateString);
    const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
    const day = date.toLocaleDateString('en-US', { weekday: 'short' });
    return `${day} ${time}`;
  };
  
  const formatDateDetail = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  };

  if (selectedEmailId) {
    if (detailLoading || !selectedEmail) {
      return (
        <div className="flex-1 flex flex-col h-full bg-white justify-center items-center">
          <Spinner />
        </div>
      );
    }

    return (
      <div className="flex-1 flex flex-col h-full bg-white">
        {/* Detail Header */}
        <div className="px-8 py-6 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => setSelectedEmailId(null)} className="text-gray-500 hover:text-gray-800 transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="text-xl font-medium text-gray-800 truncate max-w-2xl">
              {selectedEmail.subject || 'No Subject'} | {selectedEmail.id.split('-')[0].toUpperCase()}
            </h1>
          </div>
          <div className="flex items-center gap-4 text-gray-400">
            <button 
              onClick={() => toggleStar(selectedEmail.id, selectedEmail.starred)} 
              className={`hover:text-yellow-400 transition-colors ${selectedEmail.starred ? 'text-yellow-400' : ''}`}
            >
              <Star className="w-5 h-5" fill={selectedEmail.starred ? 'currentColor' : 'none'} />
            </button>
            <button className="hover:text-gray-600 transition-colors">
              <Archive className="w-5 h-5" />
            </button>
            <button className="hover:text-red-600 transition-colors">
              <Trash className="w-5 h-5" />
            </button>
            <div className="w-8 h-8 rounded-full bg-gray-200 ml-2 overflow-hidden border border-gray-200">
              <img src={`https://ui-avatars.com/api/?name=${selectedEmail.sender?.name || 'User'}&background=random`} alt="Sender" className="w-full h-full object-cover" />
            </div>
          </div>
        </div>
        
        {/* Detail Body */}
        <div className="flex-1 overflow-auto p-8 max-w-5xl mx-auto w-full">
          <div className="flex items-start gap-4 mb-8">
            <div className="w-10 h-10 rounded-full bg-green-500 flex items-center justify-center text-white font-bold text-lg flex-shrink-0">
              {selectedEmail.sender?.name?.[0]?.toUpperCase() || 'S'}
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-semibold text-gray-900 mr-2">{selectedEmail.sender?.name || 'Sender'}</span>
                  <span className="text-sm text-gray-500">&lt;{selectedEmail.sender?.email || 'sender@example.com'}&gt;</span>
                </div>
                <span className="text-sm text-gray-500">{formatDateDetail(selectedEmail.scheduled_at || selectedEmail.created_at)}</span>
              </div>
              <div className="text-sm text-gray-500 mt-1 flex items-center gap-1">
                to {selectedEmail.recipient_email} <ChevronDown className="w-3 h-3 cursor-pointer" />
              </div>
            </div>
          </div>
          
          <div 
            className="prose prose-sm max-w-none text-gray-800 leading-relaxed" 
            dangerouslySetInnerHTML={{ __html: (selectedEmail.body || '').replace(/\n/g, '<br/>') }} 
          />

          {selectedEmail.campaign_attachments && Array.isArray(selectedEmail.campaign_attachments) && selectedEmail.campaign_attachments.length > 0 && (
            <div className="mt-8 border-t border-gray-100 pt-6">
              <h3 className="text-sm font-medium text-gray-900 mb-4 flex items-center gap-2">
                <Paperclip className="w-4 h-4 text-gray-400" />
                {selectedEmail.campaign_attachments.length} Attachment{selectedEmail.campaign_attachments.length > 1 ? 's' : ''}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                {selectedEmail.campaign_attachments.map((att: any, idx: number) => {
                  const filename = att.path ? att.path.split(/[\\/]/).pop() : att.filename;
                  // In production, Vercel proxies /uploads/* to the backend.
                  // In local dev, hit the backend directly.
                  const isProd = import.meta.env.PROD;
                  const backendBaseUrl = (import.meta.env.VITE_API_URL || 'http://localhost:4000/api').replace('/api', '');
                  const downloadUrl = isProd
                    ? `/uploads/${encodeURIComponent(filename)}`
                    : `${backendBaseUrl}/uploads/${encodeURIComponent(filename)}`;
                  const isImage = /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(filename);

                  if (isImage) {
                    return (
                      <a
                        key={idx}
                        href={downloadUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex flex-col rounded-lg border border-gray-200 overflow-hidden hover:border-green-500 transition-colors group relative"
                      >
                        <div className="h-32 w-full bg-gray-100 flex items-center justify-center overflow-hidden">
                          <img src={downloadUrl} alt={att.filename} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                        </div>
                        <div className="p-3 bg-white flex-1 flex flex-col justify-between">
                          <p className="text-sm font-medium text-gray-900 truncate" title={att.filename}>
                            {att.filename}
                          </p>
                          <p className="text-xs text-gray-500 mt-1">
                            {(att.size / 1024).toFixed(1)} KB
                          </p>
                        </div>
                        <div className="absolute top-2 right-2 p-1.5 bg-white/90 rounded-md shadow-sm opacity-0 group-hover:opacity-100 transition-opacity">
                          <Download className="w-4 h-4 text-gray-700" />
                        </div>
                      </a>
                    );
                  }

                  return (
                    <a
                      key={idx}
                      href={downloadUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 hover:border-green-500 hover:bg-green-50 transition-colors group"
                    >
                      <div className="w-10 h-10 rounded bg-gray-100 flex items-center justify-center flex-shrink-0 group-hover:bg-green-100 transition-colors">
                        <Paperclip className="w-5 h-5 text-gray-500 group-hover:text-green-600 transition-colors" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate" title={att.filename}>
                          {att.filename}
                        </p>
                        <p className="text-xs text-gray-500">
                          {(att.size / 1024).toFixed(1)} KB
                        </p>
                      </div>
                      <Download className="w-4 h-4 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </a>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-white">
      {/* Top Bar */}
      <div className="px-8 py-6 border-b border-gray-100 flex items-center justify-between">
        <div className="relative w-full max-w-md">
          <Input
            icon={<Search className="h-4 w-4" />}
            placeholder="Search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10 rounded-full bg-gray-50 focus:bg-white"
          />
        </div>
        <div className="flex items-center gap-4 text-gray-400">
          <button className="hover:text-gray-600 transition-colors">
            <Filter className="w-4 h-4" />
          </button>
          <button onClick={fetchEmails} className="hover:text-gray-600 transition-colors">
            <RefreshCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex justify-center p-8">
            <Spinner />
          </div>
        ) : emails.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <p>No {type} emails found.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {emails.map((email) => (
              <div
                key={email.id}
                onClick={() => setSelectedEmailId(email.id)}
                className="group flex items-center px-8 py-4 hover:bg-gray-50 transition-colors cursor-pointer"
              >
                <div className="w-[180px] text-sm font-medium text-gray-900 truncate pr-4">
                  To: {email.recipient_email.split('@')[0]}
                </div>
                
                <div className="flex-1 flex items-center gap-3 min-w-0 pr-4">
                  <span
                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${
                      type === 'scheduled' || email.status === 'scheduled' || email.status === 'rate_limited'
                        ? 'bg-orange-100 text-orange-800'
                        : email.status === 'failed'
                        ? 'bg-red-100 text-red-800'
                        : 'bg-gray-100 text-gray-800'
                    }`}
                  >
                    {type === 'scheduled' || email.status === 'scheduled' || email.status === 'rate_limited'
                      ? `⏰ ${formatDateList(email.scheduled_at)}`
                      : `Sent ${email.sent_at ? formatDateList(email.sent_at) : ''}`}
                  </span>
                  
                  <Badge status={email.status} />
                  
                  <span className="text-sm text-gray-900 font-bold truncate flex-shrink-0 ml-2">
                    {email.subject || 'No Subject'}
                  </span>
                  <span className="text-sm text-gray-400 truncate hidden sm:block">
                    - {email.body ? email.body.replace(/<[^>]*>?/gm, '').trim() : ''}
                  </span>
                </div>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleStar(email.id, email.starred);
                  }}
                  className={`flex-shrink-0 ml-4 ${
                    email.starred ? 'text-yellow-400' : 'text-gray-300 opacity-0 group-hover:opacity-100'
                  } hover:text-yellow-400 transition-all`}
                >
                  <Star className="w-4 h-4" fill={email.starred ? 'currentColor' : 'none'} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;
