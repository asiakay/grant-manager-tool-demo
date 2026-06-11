import { useState } from "react";
import AdminUpload from "./AdminUpload";

interface Props {
  isAdmin: boolean;
  onBack: () => void;
}

export default function AdminPage({ isAdmin, onBack }: Props) {
  const [uploaded, setUploaded] = useState(false);

  return (
    <div className="min-h-screen bg-gray-950 p-4 sm:p-8">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="btn-ghost gap-1.5 px-2.5"
            aria-label="Back to dashboard"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Dashboard
          </button>
          <h1 className="text-xl font-bold text-white">Admin</h1>
        </div>

        {!isAdmin ? (
          <div className="bg-amber-900/30 border border-amber-700 text-amber-300 rounded-xl px-5 py-4 text-sm">
            You don't have admin access. Contact the site administrator to request it.
          </div>
        ) : (
          <>
            <h2 className="text-sm font-medium text-gray-400 uppercase tracking-wider">
              Grant data
            </h2>
            {uploaded && (
              <div className="bg-green-900/30 border border-green-700 text-green-300 rounded-xl px-4 py-3 text-sm">
                Grants updated. Return to the{" "}
                <button onClick={onBack} className="underline hover:text-green-200">
                  dashboard
                </button>{" "}
                to see the changes.
              </div>
            )}
            <AdminUpload
              open={true}
              inline={true}
              onClose={onBack}
              onUploaded={() => setUploaded(true)}
            />
          </>
        )}
      </div>
    </div>
  );
}
