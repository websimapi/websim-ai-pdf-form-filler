import * as PDFLib from 'pdf-lib';
import Tesseract from 'tesseract.js';

// Load PDF.js from unpkg
const pdfjsLib = await import('https://unpkg.com/pdfjs-dist@3.4.120/build/pdf.min.js');

// Set up PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://unpkg.com/pdfjs-dist@3.4.120/build/pdf.worker.min.js';

class PDFFormFiller {
    constructor() {
        this.pdfBytes = null;
        this.detectedFields = [];
        this.formData = {};
        this.pdfDocument = null;
        this.pageImages = [];
        this.ocrData = [];
        this.initializeEventListeners();
    }

    initializeEventListeners() {
        const uploadArea = document.getElementById('uploadArea');
        const fileInput = document.getElementById('fileInput');
        const previewBtn = document.getElementById('previewBtn');
        const downloadBtn = document.getElementById('downloadBtn');

        // Upload area click
        uploadArea.addEventListener('click', () => fileInput.click());

        // File input change
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.handleFileUpload(e.target.files[0]);
            }
        });

        // Drag and drop
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });

        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('dragover');
        });

        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                this.handleFileUpload(files[0]);
            }
        });

        // Button actions
        previewBtn.addEventListener('click', () => this.previewFilledPDF());
        downloadBtn.addEventListener('click', () => this.downloadFilledPDF());
    }

    async handleFileUpload(file) {
        if (file.type !== 'application/pdf') {
            alert('Please upload a PDF file');
            return;
        }

        this.showSection('processingSection');
        
        try {
            const arrayBuffer = await file.arrayBuffer();
            this.pdfBytes = new Uint8Array(arrayBuffer);
            
            // Load PDF with PDF.js
            const loadingTask = pdfjsLib.getDocument(this.pdfBytes);
            this.pdfDocument = await loadingTask.promise;
            
            await this.renderPDFPages();
            await this.performOCR();
            await this.analyzeFormFields();
            
            this.showSection('previewSection');
        } catch (error) {
            console.error('Error processing PDF:', error);
            alert('Error processing PDF. Please try again.');
            this.showSection('uploadSection');
        }
    }

    async renderPDFPages() {
        this.pageImages = [];
        const canvas = document.getElementById('pdfCanvas');
        const ctx = canvas.getContext('2d');
        
        // Render first page for preview
        const page = await this.pdfDocument.getPage(1);
        const viewport = page.getViewport({ scale: 1.5 });
        
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        
        const renderContext = {
            canvasContext: ctx,
            viewport: viewport
        };
        
        await page.render(renderContext).promise;
        
        // Convert all pages to images for AI analysis
        for (let pageNum = 1; pageNum <= this.pdfDocument.numPages; pageNum++) {
            const page = await this.pdfDocument.getPage(pageNum);
            const viewport = page.getViewport({ scale: 2.0 }); // Higher scale for better AI analysis
            
            const tempCanvas = document.createElement('canvas');
            const tempCtx = tempCanvas.getContext('2d');
            tempCanvas.height = viewport.height;
            tempCanvas.width = viewport.width;
            
            await page.render({
                canvasContext: tempCtx,
                viewport: viewport
            }).promise;
            
            const imageDataUrl = tempCanvas.toDataURL('image/png');
            this.pageImages.push({
                pageNum,
                imageDataUrl,
                width: viewport.width,
                height: viewport.height,
                scale: 2.0
            });
        }
    }

    async performOCR() {
        this.ocrData = [];
        
        for (let i = 0; i < this.pageImages.length; i++) {
            const pageImage = this.pageImages[i];
            
            try {
                const result = await Tesseract.recognize(
                    pageImage.imageDataUrl,
                    'eng',
                    {
                        logger: m => {
                            if (m.status === 'recognizing text') {
                                document.querySelector('.processing-section p').textContent = 
                                    `Performing OCR on page ${i + 1}/${this.pageImages.length}... ${Math.round(m.progress * 100)}%`;
                            }
                        }
                    }
                );
                
                this.ocrData.push({
                    pageNum: pageImage.pageNum,
                    words: result.data.words,
                    lines: result.data.lines,
                    text: result.data.text
                });
            } catch (error) {
                console.error(`OCR failed for page ${pageImage.pageNum}:`, error);
                this.ocrData.push({
                    pageNum: pageImage.pageNum,
                    words: [],
                    lines: [],
                    text: ''
                });
            }
        }
        
        document.querySelector('.processing-section p').textContent = 'AI is analyzing form fields...';
    }

    async analyzeFormFields() {
        try {
            this.detectedFields = [];
            
            // Analyze each page
            for (let i = 0; i < this.pageImages.length; i++) {
                const pageImage = this.pageImages[i];
                const ocrData = this.ocrData[i];
                
                const completion = await websim.chat.completions.create({
                    messages: [
                        {
                            role: "system",
                            content: `You are an expert at analyzing PDF forms to detect fillable fields. 
                            
                            I will provide you with:
                            1. An image of a PDF page
                            2. OCR text data with word positions
                            
                            Your task is to identify form fields that need to be filled out by looking for:
                            - Text labels followed by blank spaces, lines, or boxes
                            - Input areas like signature lines, date fields, checkboxes
                            - Areas that appear to accept user input
                            
                            Use the OCR data to understand the context and positioning of text elements.
                            
                            Respond with JSON in this exact format:
                            {
                              "fields": [
                                {
                                  "id": "unique_field_id",
                                  "label": "Field Label",
                                  "type": "text|email|date|number|checkbox|textarea|select",
                                  "x": 100,
                                  "y": 200,
                                  "width": 200,
                                  "height": 25,
                                  "required": true,
                                  "pageNum": 1,
                                  "confidence": 0.9
                                }
                              ]
                            }
                            
                            Coordinates should be in the image coordinate system (top-left origin).
                            Be conservative - only detect clear form fields with high confidence.`
                        },
                        {
                            role: "user", 
                            content: [
                                {
                                    type: "text",
                                    text: `Please analyze this PDF page for form fields. 
                                    
                                    OCR Text Data:
                                    Full Text: ${ocrData.text}
                                    
                                    Word Positions: ${JSON.stringify(ocrData.words.slice(0, 50).map(w => ({
                                        text: w.text,
                                        x: w.bbox.x0,
                                        y: w.bbox.y0,
                                        width: w.bbox.x1 - w.bbox.x0,
                                        height: w.bbox.y1 - w.bbox.y0
                                    })))}
                                    
                                    Page dimensions: ${pageImage.width}x${pageImage.height}
                                    Page number: ${pageImage.pageNum}`
                                },
                                {
                                    type: "image_url",
                                    image_url: { url: pageImage.imageDataUrl }
                                }
                            ]
                        }
                    ],
                    json: true
                });

                const result = JSON.parse(completion.content);
                if (result.fields && result.fields.length > 0) {
                    // Convert coordinates from image scale to PDF scale
                    const scaledFields = result.fields.map(field => ({
                        ...field,
                        x: field.x / pageImage.scale,
                        y: field.y / pageImage.scale,
                        width: field.width / pageImage.scale,
                        height: field.height / pageImage.scale,
                        pageNum: pageImage.pageNum
                    }));
                    
                    this.detectedFields.push(...scaledFields);
                }
            }
            
            // If no fields detected, provide fallback
            if (this.detectedFields.length === 0) {
                this.detectedFields = [
                    { id: 'name', label: 'Full Name', type: 'text', x: 100, y: 100, width: 200, height: 25, required: true, pageNum: 1 },
                    { id: 'email', label: 'Email Address', type: 'email', x: 100, y: 150, width: 200, height: 25, required: true, pageNum: 1 },
                    { id: 'date', label: 'Date', type: 'date', x: 100, y: 200, width: 150, height: 25, required: false, pageNum: 1 }
                ];
            }
            
            this.displayDetectedFields();
            this.generateDynamicForm();
            
        } catch (error) {
            console.error('Error analyzing form fields:', error);
            // Fallback with OCR-based field detection
            this.fallbackOCRDetection();
        }
    }

    fallbackOCRDetection() {
        // Simple OCR-based field detection as fallback
        this.detectedFields = [];
        
        this.ocrData.forEach(pageOCR => {
            const commonLabels = [
                'name', 'first name', 'last name', 'full name',
                'email', 'e-mail', 'email address',
                'date', 'today\'s date', 'signature date',
                'address', 'street address', 'city', 'state', 'zip',
                'phone', 'telephone', 'mobile',
                'signature', 'sign here', 'your signature'
            ];
            
            pageOCR.words.forEach((word, index) => {
                const text = word.text.toLowerCase();
                const matchedLabel = commonLabels.find(label => 
                    text.includes(label) || label.includes(text)
                );
                
                if (matchedLabel && word.text.length > 2) {
                    let fieldType = 'text';
                    if (matchedLabel.includes('email')) fieldType = 'email';
                    else if (matchedLabel.includes('date')) fieldType = 'date';
                    else if (matchedLabel.includes('signature')) fieldType = 'text';
                    
                    this.detectedFields.push({
                        id: `field_${pageOCR.pageNum}_${index}`,
                        label: word.text,
                        type: fieldType,
                        x: word.bbox.x1 + 10, // Position field after the label
                        y: word.bbox.y0,
                        width: 150,
                        height: 20,
                        required: true,
                        pageNum: pageOCR.pageNum
                    });
                }
            });
        });
        
        this.displayDetectedFields();
        this.generateDynamicForm();
    }

    displayDetectedFields() {
        const container = document.getElementById('detectedFields');
        
        if (this.detectedFields.length === 0) {
            container.innerHTML = '<p>No form fields detected. Please try a different PDF.</p>';
            return;
        }

        container.innerHTML = `
            <div class="field-detection">
                <h4>🔍 Detected ${this.detectedFields.length} Form Fields</h4>
                ${this.detectedFields.map(field => 
                    `<div class="detected-field">
                        ${field.label} (${field.type}) ${field.required ? '- Required' : ''}
                    </div>`
                ).join('')}
            </div>
        `;
    }

    generateDynamicForm() {
        const container = document.getElementById('formFields');
        
        container.innerHTML = this.detectedFields.map(field => {
            const inputId = `input_${field.id}`;
            let inputHTML = '';
            
            switch (field.type) {
                case 'textarea':
                    inputHTML = `<textarea id="${inputId}" rows="4" placeholder="Enter ${field.label.toLowerCase()}"></textarea>`;
                    break;
                case 'select':
                    inputHTML = `
                        <select id="${inputId}">
                            <option value="">Select ${field.label}</option>
                            <option value="Option 1">Option 1</option>
                            <option value="Option 2">Option 2</option>
                            <option value="Option 3">Option 3</option>
                        </select>
                    `;
                    break;
                case 'checkbox':
                    inputHTML = `<input type="checkbox" id="${inputId}"> <label for="${inputId}" style="display: inline; margin-left: 8px;">${field.label}</label>`;
                    break;
                default:
                    inputHTML = `<input type="${field.type}" id="${inputId}" placeholder="Enter ${field.label.toLowerCase()}" ${field.required ? 'required' : ''}>`;
            }
            
            return `
                <div class="form-field">
                    ${field.type !== 'checkbox' ? `<label for="${inputId}">${field.label} ${field.required ? '*' : ''}</label>` : ''}
                    ${inputHTML}
                </div>
            `;
        }).join('');

        // Add event listeners to form inputs
        this.detectedFields.forEach(field => {
            const input = document.getElementById(`input_${field.id}`);
            if (input) {
                input.addEventListener('input', () => {
                    this.formData[field.id] = input.type === 'checkbox' ? input.checked : input.value;
                });
            }
        });
    }

    async previewFilledPDF() {
        const filledPDFBytes = await this.generateFilledPDF();
        
        // Show the output section and render the filled PDF
        document.getElementById('outputSection').style.display = 'block';
        
        const canvas = document.getElementById('outputCanvas');
        const ctx = canvas.getContext('2d');
        
        // Simple preview representation
        const originalCanvas = document.getElementById('pdfCanvas');
        canvas.width = originalCanvas.width;
        canvas.height = originalCanvas.height;
        
        // Copy original PDF
        ctx.drawImage(originalCanvas, 0, 0);
        
        // Overlay form data
        ctx.fillStyle = '#007bff';
        ctx.font = '14px Arial';
        
        this.detectedFields.forEach(field => {
            const value = this.formData[field.id];
            if (value) {
                ctx.fillText(value.toString(), field.x, field.y + 15);
            }
        });
        
        canvas.scrollIntoView({ behavior: 'smooth' });
    }

    async generateFilledPDF() {
        const pdfDoc = await PDFLib.PDFDocument.load(this.pdfBytes);
        const pages = pdfDoc.getPages();
        const font = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);
        
        // Group fields by page
        const fieldsByPage = {};
        this.detectedFields.forEach(field => {
            if (!fieldsByPage[field.pageNum]) {
                fieldsByPage[field.pageNum] = [];
            }
            fieldsByPage[field.pageNum].push(field);
        });
        
        // Add form data to each page
        Object.keys(fieldsByPage).forEach(pageNum => {
            const page = pages[parseInt(pageNum) - 1];
            const pageHeight = page.getHeight();
            
            fieldsByPage[pageNum].forEach(field => {
                const value = this.formData[field.id];
                if (value) {
                    page.drawText(value.toString(), {
                        x: field.x,
                        y: pageHeight - field.y - 15, // Convert from top-left to bottom-left coordinate system
                        size: 10,
                        font: font,
                        color: PDFLib.rgb(0, 0, 0)
                    });
                }
            });
        });
        
        return await pdfDoc.save();
    }

    async downloadFilledPDF() {
        try {
            const filledPDFBytes = await this.generateFilledPDF();
            
            const blob = new Blob([filledPDFBytes], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = url;
            a.download = 'filled-form.pdf';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            
            URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Error generating PDF:', error);
            alert('Error generating PDF. Please try again.');
        }
    }

    showSection(sectionId) {
        const sections = ['uploadSection', 'processingSection', 'previewSection', 'outputSection'];
        sections.forEach(id => {
            document.getElementById(id).style.display = id === sectionId ? 'block' : 'none';
        });
    }
}

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    new PDFFormFiller();
});