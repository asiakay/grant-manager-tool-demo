import React, { useState } from 'react';
import PropTypes from 'prop-types';
import { DataGrid } from '@mui/x-data-grid';
import Drawer from '@mui/material/Drawer';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';

// columns for DataGrid: Name | Sponsor | Deadline | Relevance | Fit | Ease | Weighted Score
const columns = [
  { field: 'name', headerName: 'Name', flex: 1 },
  { field: 'sponsor', headerName: 'Sponsor', flex: 1 },
  {
    field: 'deadline',
    headerName: 'Deadline',
    type: 'date',
    flex: 1,
    valueGetter: (params) => new Date(params.value),
  },
  { field: 'relevance', headerName: 'Relevance', type: 'number', flex: 1 },
  { field: 'fit', headerName: 'Fit', type: 'number', flex: 1 },
  { field: 'ease', headerName: 'Ease', type: 'number', flex: 1 },
  {
    field: 'weightedScore',
    headerName: 'Weighted Score',
    type: 'number',
    flex: 1,
  },
];

/**
 * Main scoring table with inline filters and a detail drawer.
 *
 * Data flow:
 * 1. Parent component provides `rows` containing grant metadata.
 * 2. Local filter state (`deadlineFilter` and `minScore`) narrows `rows` to `filteredRows`.
 * 3. Selecting a row sets `selectedRow` and copies its `notes` for editing.
 * 4. The detail drawer displays `selectedRow` information and captures note edits,
 *    ready to be persisted via future callback props.
 *
 * @param {Object[]} rows - rows to display. Each row must include an `id` field.
 */
function ScoringTable({ rows }) {
  const [selectedRow, setSelectedRow] = useState(null);
  const [notes, setNotes] = useState('');
  const [deadlineFilter, setDeadlineFilter] = useState('');
  const [minScore, setMinScore] = useState('');

  const filteredRows = rows.filter((row) => {
    const deadlineOk = deadlineFilter
      ? new Date(row.deadline) <= new Date(deadlineFilter)
      : true;
    const scoreOk = minScore ? row.weightedScore >= parseFloat(minScore) : true;
    return deadlineOk && scoreOk;
  });

  return (
    <div className="w-full">
      {/* filters */}
      <div className="flex space-x-4 mb-4">
        <TextField
          type="date"
          label="Deadline Before"
          value={deadlineFilter}
          onChange={(e) => setDeadlineFilter(e.target.value)}
          size="small"
        />
        <TextField
          type="number"
          label="Min Score"
          value={minScore}
          onChange={(e) => setMinScore(e.target.value)}
          size="small"
        />
      </div>

      {/* scoring table */}
      <div className="h-96 w-full">
        <DataGrid
          rows={filteredRows}
          columns={columns}
          onRowClick={(params) => {
            setSelectedRow(params.row);
            setNotes(params.row.notes || '');
          }}
          disableRowSelectionOnClick
        />
      </div>

      {/* detail drawer */}
      <Drawer
        anchor="right"
        open={!!selectedRow}
        onClose={() => {
          setSelectedRow(null);
          setNotes('');
        }}
      >
        {selectedRow && (
          <div className="p-4 w-96">
            <h2 className="text-xl font-bold mb-2">{selectedRow.name}</h2>
            <p className="mb-2">
              <span className="font-semibold">Synopsis:</span> {selectedRow.synopsis}
            </p>
            <p className="mb-2">
              <span className="font-semibold">Eligibility:</span> {selectedRow.eligibility}
            </p>
            <p className="mb-2">
              <span className="font-semibold">Award Range:</span> {selectedRow.awardRange}
            </p>
            <p className="mb-2">
              <span className="font-semibold">Application:</span>{' '}
              <a
                href={selectedRow.applicationLink}
                className="text-blue-600 underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                Link
              </a>
            </p>

            <div className="flex flex-col space-y-2 mt-4">
              <Button
                variant="contained"
                onClick={() => console.log('Mark as Candidate', selectedRow.id)}
              >
                Mark as Candidate
              </Button>
              <Button
                variant="outlined"
                onClick={() => console.log('Add to Watchlist', selectedRow.id)}
              >
                Add to Watchlist
              </Button>
              <TextField
                label="Notes"
                multiline
                minRows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}

ScoringTable.propTypes = {
  rows: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
      name: PropTypes.string.isRequired,
      sponsor: PropTypes.string.isRequired,
      deadline: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.instanceOf(Date),
      ]).isRequired,
      relevance: PropTypes.number.isRequired,
      fit: PropTypes.number.isRequired,
      ease: PropTypes.number.isRequired,
      weightedScore: PropTypes.number.isRequired,
      synopsis: PropTypes.string,
      eligibility: PropTypes.string,
      awardRange: PropTypes.string,
      applicationLink: PropTypes.string,
      notes: PropTypes.string,
    })
  ).isRequired,
};

export default ScoringTable;
